import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { getVerifiedTelegramUser } from '@/lib/telegram-auth';
import { WALLETS } from '@/lib/wallets';
import { Address } from '@ton/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FEE_NANOTON = '100000000';
const FEE_TON = '0.1';
const RECEIVER = process.env.TON_MINING_FEE_WALLET || WALLETS.find((wallet) => wallet.code === 'gram')?.address || '';
const RECEIVER_RAW = canonicalAddress(RECEIVER);
const TONCENTER = (process.env.TONCENTER_API_URL || 'https://toncenter.com/api/v2').replace(/\/$/, '');
const PAYMENT_WINDOW_MS = 30 * 60 * 1000;

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}
function clean(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function canonicalAddress(value: string): string {
  try { return Address.parse(value).toRawString().toLowerCase(); } catch { return ''; }
}

async function fetchIncomingTransactions() {
  const headers: Record<string,string> = { 'Content-Type': 'application/json' };
  if (process.env.TONCENTER_API_KEY) headers['X-API-Key'] = process.env.TONCENTER_API_KEY;
  const response = await fetch(TONCENTER + '/getTransactions', {
    method: 'POST', headers,
    body: JSON.stringify({ address: RECEIVER, limit: 100 }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('toncenter_unavailable');
  const data = await response.json() as { ok?: boolean; result?: Array<{
    transaction_id?: { hash?: string; lt?: string };
    utime?: number;
    in_msg?: { source?: string; destination?: string; value?: string; message?: string };
  }> };
  if (data.ok !== true || !Array.isArray(data.result)) throw new Error('toncenter_invalid_response');
  return data.result;
}

export async function GET(req: NextRequest) {
  const user = getVerifiedTelegramUser(req);
  if (!user) return fail('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const id = String(user.id);
    const [settings, player] = await Promise.all([
      db.execute("SELECT setting_value FROM app_settings WHERE setting_key='mining_fee_enabled'"),
      db.execute({ sql: 'SELECT fee_exempt,mining_fee_paid_at,ton_wallet_address FROM players WHERE telegram_id=?', args: [id] }),
    ]);
    if (!player.rows.length) return fail('player_not_found',404);
    const enabled = String(settings.rows[0]?.setting_value ?? '1') !== '0';
    const exempt = Number(player.rows[0].fee_exempt ?? 0) === 1;
    const paid = !!player.rows[0].mining_fee_paid_at;
    return NextResponse.json({
      required: enabled && !exempt && !paid, exempt, paid,
      amount: FEE_TON, currency: 'TON', destination: RECEIVER,
      savedWalletAddress: player.rows[0].ton_wallet_address ? String(player.rows[0].ton_wallet_address) : '',
      network: 'TON Mainnet',
      message: 'للدعم والحفاظ على استمرارية الشبكة وحمايتها من الحسابات الآلية، يلزم دفع رسوم تفعيل رمزية لمرة واحدة قدرها 0.1 TON تُدفع مرة واحدة مدى الحياة قبل بدء التعدين.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('mining_activation_status_failed', error);
    return fail('activation_status_unavailable', 503);
  }
}

export async function POST(req: NextRequest) {
  const user = getVerifiedTelegramUser(req);
  if (!user) return fail('telegram_auth_required', 401);
  let body: { action?: unknown; walletAddress?: unknown; paymentId?: unknown };
  try { body = await req.json(); } catch { return fail('invalid_body'); }
  const action = clean(body.action);
  const sender = clean(body.walletAddress);


  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const id = String(user.id);
    const playerState = await db.execute({
      sql: "SELECT p.fee_exempt,p.mining_fee_paid_at,s.setting_value AS fee_enabled FROM players p LEFT JOIN app_settings s ON s.setting_key='mining_fee_enabled' WHERE p.telegram_id=?",
      args: [id],
    });
    if (!playerState.rows.length) return fail('player_not_found',404);
    const player = playerState.rows[0];
    if (action === 'save_wallet') {
      if (!sender || sender.length > 128 || !canonicalAddress(sender)) return fail('invalid_wallet_address');
      await db.execute({ sql: 'UPDATE players SET ton_wallet_address=? WHERE telegram_id=?', args: [sender, id] });
      return NextResponse.json({ ok: true, saved: true }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (Number(player.fee_exempt ?? 0) === 1 || !!player.mining_fee_paid_at || String(player.fee_enabled ?? '1') === '0') {
      return NextResponse.json({ ok:true, alreadyActivated:true }, { headers:{'Cache-Control':'no-store'} });
    }

    if (action === 'create') {
      if (!RECEIVER) return fail('mining_fee_wallet_not_configured',503);
      if (!sender || sender.length > 128 || !canonicalAddress(sender)) return fail('wallet_address_required');
      // A payment intent is immutable: never recycle an old comment, otherwise a
      // previous on-chain payment could satisfy a newly created intent.
      const paymentId = randomUUID();
      await db.execute({
        sql: "INSERT INTO mining_fee_payments(id,telegram_id,tx_hash,sender_address,recipient_address,amount_nanoton,status) VALUES(?,?,?, ?,?,?, 'pending')",
        args: [paymentId,id,'pending:'+paymentId,sender,RECEIVER,FEE_NANOTON],
      });
      return NextResponse.json({ ok:true, paymentId, amountNanoton:FEE_NANOTON, destination:RECEIVER, network:'-239' }, { headers:{'Cache-Control':'no-store'} });
    }

    if (action === 'cancel') {
      const paymentId = clean(body.paymentId);
      if (!paymentId || paymentId.length > 64) return fail('invalid_payment_id');
      await db.execute({
        sql: "UPDATE mining_fee_payments SET status='expired' WHERE id=? AND telegram_id=? AND status='pending'",
        args: [paymentId,id],
      });
      return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
    }

    if (action === 'verify') {
      if (!RECEIVER) return fail('mining_fee_wallet_not_configured',503);
      const paymentId = clean(body.paymentId);
      if (!paymentId || paymentId.length > 64) return fail('invalid_payment_id');
      const paymentResult = await db.execute({
        sql: "SELECT id,telegram_id,sender_address,recipient_address,amount_nanoton,created_at,status FROM mining_fee_payments WHERE id=? AND telegram_id=?",
        args: [paymentId,id],
      });
      if (!paymentResult.rows.length) return fail('payment_not_found',404);
      const payment = paymentResult.rows[0];
      if (String(payment.status) === 'confirmed') return NextResponse.json({ok:true,activated:true});
      if (String(payment.status) !== 'pending') return fail('payment_not_pending',409);
      if (Date.now() - Date.parse(String(payment.created_at).replace(' ','T')+'Z') > PAYMENT_WINDOW_MS) return fail('payment_expired',410);

      const transactions = await fetchIncomingTransactions();
      const createdAt = Date.parse(String(payment.created_at).replace(' ','T')+'Z') / 1000;
      const incoming = transactions.find((item) => {
        const msg = item.in_msg;
        const isPaymentComment = typeof msg?.message === 'string' &&
          msg.message.trim() === 'ARMCO MINING ' + paymentId;
        return !!msg &&
          canonicalAddress(msg.destination ?? '') === RECEIVER_RAW &&
          canonicalAddress(msg.source ?? '') === canonicalAddress(String(payment.sender_address)) &&
          BigInt(msg.value ?? '0') >= BigInt(FEE_NANOTON) &&
          Number(item.utime ?? 0) >= createdAt - 30 &&
          isPaymentComment &&
          !!item.transaction_id?.hash;
      });
      if (!incoming?.transaction_id?.hash) return fail('payment_not_found_yet',202);

      const tx = await db.transaction('write');
      try {
        const fresh = await tx.execute({sql:"SELECT fee_exempt,mining_fee_paid_at FROM players WHERE telegram_id=?",args:[id]});
        if (!fresh.rows.length) { await tx.rollback(); return fail('player_not_found',404); }
        if (Number(fresh.rows[0].fee_exempt ?? 0) === 1 || !!fresh.rows[0].mining_fee_paid_at) {
          await tx.rollback();
          return NextResponse.json({ok:true,alreadyActivated:true});
        }
        const used = await tx.execute({sql:"SELECT id FROM mining_fee_payments WHERE tx_hash=? AND status='confirmed'",args:[String(incoming.transaction_id.hash)]});
        if (used.rows.length) { await tx.rollback(); return fail('transaction_already_used',409); }
        await tx.execute({
          sql:"UPDATE mining_fee_payments SET tx_hash=?,status='confirmed' WHERE id=? AND status='pending'",
          args:[String(incoming.transaction_id.hash),paymentId],
        });
        const update = await tx.execute({
          sql:"UPDATE players SET mining_fee_paid_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND mining_fee_paid_at IS NULL AND fee_exempt=0",
          args:[id],
        });
        if (Number(update.rowsAffected)!==1) { await tx.rollback(); return fail('activation_conflict',409); }
        await tx.execute({
          sql:'INSERT INTO admin_audit_logs(id,admin_id,action,target_type,target_id,details_json) VALUES(?,?,?,?,?,?)',
          args:[randomUUID(),'system','mining_fee_paid','player',id,JSON.stringify({txHash:incoming.transaction_id.hash,sender,amountTon:FEE_TON})],
        });
        await tx.commit();
        return NextResponse.json({ok:true,activated:true},{headers:{'Cache-Control':'no-store'}});
      } catch(error) { await tx.rollback(); throw error; }
    }
    return fail('invalid_action');
  } catch(error) {
    console.error('mining_fee_verification_failed',error);
    return fail('mining_fee_verification_failed',503);
  }
}
