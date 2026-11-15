import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { getVerifiedTelegramUser } from '@/lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FEE_NANOTON = '50000000';
const FEE_TON = '0.05';
const RECEIVER = process.env.TON_MINING_FEE_WALLET || '';
const TONCENTER = (process.env.TONCENTER_API_URL || 'https://toncenter.com/api/v2').replace(/\/$/, '');

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}
function normalizeAddress(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function GET(req: NextRequest) {
  const user = getVerifiedTelegramUser(req);
  if (!user) return fail('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const id = String(user.id);
    const [settings, player] = await Promise.all([
      db.execute("SELECT value FROM app_settings WHERE key='mining_fee_enabled'"),
      db.execute({ sql: 'SELECT fee_exempt, mining_fee_paid_at FROM players WHERE telegram_id=?', args: [id] }),
    ]);
    const enabled = String(settings.rows[0]?.value ?? '1') !== '0';
    const row = player.rows[0];
    const exempt = Number(row?.fee_exempt ?? 0) === 1;
    const paid = !!row?.mining_fee_paid_at;
    return NextResponse.json({
      required: enabled && !exempt && !paid,
      exempt, paid, amount: FEE_TON, currency: 'TON',
      destination: RECEIVER,
      network: 'TON Mainnet',
      message: 'للدعم والحفاظ على استمرارية الشبكة وحمايتها من الحسابات الآلية، يلزم دفع رسوم تفعيل رمزية لمرة واحدة قدرها 0.05 TON قبل بدء التعدين.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('mining_activation_status_failed', error);
    return fail('activation_status_unavailable', 503);
  }
}

export async function POST(req: NextRequest) {
  const user = getVerifiedTelegramUser(req);
  if (!user) return fail('telegram_auth_required', 401);
  let body: { txHash?: unknown; walletAddress?: unknown };
  try { body = await req.json(); } catch { return fail('invalid_body'); }
  const txHash = normalizeAddress(body.txHash).replace(/^0x/i, '').toLowerCase();
  const sender = normalizeAddress(body.walletAddress);
  if (!/^[a-f0-9]{64}$/.test(txHash) || !sender || sender.length > 128) return fail('invalid_transaction_reference');

  try {
    await ensureDatabaseSchema();
    if (!RECEIVER) return fail('mining_fee_wallet_not_configured', 503);
    const db = getTurso();
    const id = String(user.id);
    const state = await db.execute({
      sql: "SELECT p.fee_exempt,p.mining_fee_paid_at,s.value AS fee_enabled FROM players p LEFT JOIN app_settings s ON s.key='mining_fee_enabled' WHERE p.telegram_id=?",
      args: [id],
    });
    if (!state.rows.length) return fail('player_not_found', 404);
    const player = state.rows[0];
    if (Number(player.fee_exempt ?? 0) === 1 || !!player.mining_fee_paid_at || String(player.fee_enabled ?? '1') === '0') {
      return NextResponse.json({ ok: true, alreadyActivated: true }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const pending = await db.execute({
      sql: "SELECT id FROM mining_fee_payments WHERE tx_hash=?",
      args: [txHash],
    });
    if (pending.rows.length) return fail('transaction_already_used', 409);

    const headers: Record<string,string> = { 'Content-Type': 'application/json' };
    if (process.env.TONCENTER_API_KEY) headers['X-API-Key'] = process.env.TONCENTER_API_KEY;
    const chainResponse = await fetch(TONCENTER + '/getTransactions', {
      method: 'POST', headers,
      body: JSON.stringify({ address: RECEIVER, limit: 100 }),
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (!chainResponse.ok) return fail('blockchain_verification_unavailable', 503);
    const chainData = await chainResponse.json() as {
      ok?: boolean;
      result?: Array<{
        transaction_id?: { hash?: string; lt?: string };
        in_msg?: { source?: string; destination?: string; value?: string; message?: string };
      }>;
    };
    if (chainData.ok !== true || !Array.isArray(chainData.result)) return fail('blockchain_verification_unavailable', 503);

    const transaction = chainData.result.find((item) =>
      String(item.transaction_id?.hash ?? '').toLowerCase() === txHash
    );
    if (!transaction) return fail('transaction_not_found', 402);
    const incoming = transaction.in_msg;
    if (!incoming || incoming.destination !== RECEIVER) return fail('wrong_recipient', 400);
    if (incoming.source !== sender) return fail('sender_mismatch', 400);
    if (BigInt(incoming.value ?? '0') < BigInt(FEE_NANOTON)) return fail('insufficient_amount', 400);

    const tx = await db.transaction('write');
    try {
      const fresh = await tx.execute({
        sql: 'SELECT fee_exempt,mining_fee_paid_at FROM players WHERE telegram_id=?',
        args: [id],
      });
      if (!fresh.rows.length) { await tx.rollback(); return fail('player_not_found',404); }
      if (Number(fresh.rows[0].fee_exempt ?? 0) === 1 || !!fresh.rows[0].mining_fee_paid_at) {
        await tx.rollback();
        return NextResponse.json({ ok:true, alreadyActivated:true }, { headers:{'Cache-Control':'no-store'} });
      }
      await tx.execute({
        sql: "INSERT INTO mining_fee_payments(id,telegram_id,tx_hash,sender_address,recipient_address,amount_nanoton,status) VALUES(?,?,?,?,?,?,'confirmed')",
        args: [randomUUID(), id, txHash, sender, RECEIVER, FEE_NANOTON],
      });
      const updated = await tx.execute({
        sql: 'UPDATE players SET mining_fee_paid_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND mining_fee_paid_at IS NULL AND fee_exempt=0',
        args: [id],
      });
      if (Number(updated.rowsAffected) !== 1) { await tx.rollback(); return fail('activation_conflict',409); }
      await tx.execute({
        sql: 'INSERT INTO admin_audit_logs(id,admin_id,action,target_type,target_id,details_json) VALUES(?,?,?,?,?,?)',
        args: [randomUUID(), 'system', 'mining_fee_paid', 'player', id, JSON.stringify({ txHash, sender, amountTon:FEE_TON })],
      });
      await tx.commit();
      return NextResponse.json({ ok:true, activated:true }, { headers:{'Cache-Control':'no-store'} });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    console.error('mining_fee_verification_failed', error);
    return fail('mining_fee_verification_failed', 503);
  }
}
