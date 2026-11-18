import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Address } from '@ton/core';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { getVerifiedTelegramUser } from '@/lib/telegram-auth';
import { WALLETS } from '@/lib/wallets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECEIVER = process.env.TON_MINING_FEE_WALLET || WALLETS.find((wallet) => wallet.code === 'gram')?.address || '';
const TONCENTER = (process.env.TONCENTER_API_URL || 'https://toncenter.com/api/v2').replace(/\\/$/, '');
const FEE_NANOTON = '1000000000';
const PAYMENT_WINDOW_MS = 30 * 60 * 1000;

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}
function canonical(value: string) {
  try { return Address.parse(value).toRawString().toLowerCase(); } catch { return ''; }
}
function timestamp(value: unknown) {
  const raw = String(value ?? '');
  return Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z') || 0;
}
async function incomingTransactions() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.TONCENTER_API_KEY) headers['X-API-Key'] = process.env.TONCENTER_API_KEY;
  const response = await fetch(TONCENTER + '/getTransactions', {
    method: 'POST', headers, body: JSON.stringify({ address: RECEIVER, limit: 100 }),
    cache: 'no-store', signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('toncenter_unavailable');
  const data = await response.json() as { ok?: boolean; result?: Array<any> };
  if (data.ok !== true || !Array.isArray(data.result)) throw new Error('toncenter_invalid_response');
  return data.result;
}

export async function POST(req: NextRequest) {
  const user = getVerifiedTelegramUser(req);
  if (!user) return error('telegram_auth_required', 401);
  if (!RECEIVER) return error('ton_receiver_not_configured', 503);
  let body: { units?: unknown; tonAddress?: unknown };
  try { body = await req.json(); } catch { return error('invalid_body'); }
  const units = Number(body.units);
  const tonAddress = typeof body.tonAddress === 'string' ? body.tonAddress.trim() : '';
  if (!Number.isSafeInteger(units) || units < 100 || units > 1000) return error('invalid_units');
  if (!tonAddress || tonAddress.length > 128) return error('invalid_ton_address');
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const id = randomUUID();
    const comment = 'ARMCO WITHDRAWAL FEE ' + id;
    const expiresAt = Date.now() + PAYMENT_WINDOW_MS;
    await db.execute({
      sql: `INSERT INTO payment_transactions
        (id,telegram_id,provider,asset,network,amount,package_id,status,provider_payload_json)
        VALUES(?,?,'tonconnect_withdrawal_fee','TON','TON Mainnet','1','withdrawal_fee','pending',?)`,
      args: [id, String(user.id), JSON.stringify({ kind: 'withdrawal_fee', destination: RECEIVER, amountNanoton: FEE_NANOTON, comment, units, tonAddress, expiresAt })],
    });
    return NextResponse.json({
      payment: { id, destination: RECEIVER, amountNanoton: FEE_NANOTON, comment, expiresAt, status: 'pending' },
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('withdrawal_fee_intent_failed', e);
    return error('withdrawal_fee_intent_failed', 503);
  }
}

export async function GET(req: NextRequest) {
  const user = getVerifiedTelegramUser(req);
  if (!user) return error('telegram_auth_required', 401);
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return error('invalid_payment_id');
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const found = await db.execute({
      sql: "SELECT * FROM payment_transactions WHERE id=? AND telegram_id=? AND provider='tonconnect_withdrawal_fee'",
      args: [id, String(user.id)],
    });
    if (!found.rows.length) return error('payment_not_found', 404);
    const row = found.rows[0];
    if (String(row.status) === 'confirmed') {
      return NextResponse.json({ payment: { id, status: 'confirmed', txHash: row.tx_hash ? String(row.tx_hash) : null } }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (String(row.status) !== 'pending') return NextResponse.json({ payment: { id, status: String(row.status) } });
    const payload = JSON.parse(String(row.provider_payload_json || '{}')) as Record<string, unknown>;
    if (Date.now() > Number(payload.expiresAt ?? 0)) {
      await db.execute({ sql: "UPDATE payment_transactions SET status='expired' WHERE id=? AND status='pending'", args: [id] });
      return NextResponse.json({ payment: { id, status: 'expired' } });
    }
    const txs = await incomingTransactions();
    const createdAt = timestamp(row.created_at) / 1000;
    const foundTx = txs.find((item) => {
      const message = item.in_msg;
      return message &&
        canonical(String(message.destination ?? '')) === canonical(String(payload.destination ?? '')) &&
        String(message.value ?? '0') === String(payload.amountNanoton) &&
        String(message.message ?? '').trim() === String(payload.comment) &&
        Number(item.utime ?? 0) >= createdAt - 30 &&
        !!item.transaction_id?.hash &&
        item.description?.aborted !== true &&
        item.description?.compute_ph?.success !== false &&
        item.description?.action?.success !== false;
    });
    if (!foundTx?.transaction_id?.hash) {
      return NextResponse.json({ payment: { id, status: 'pending' } }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const changed = await db.execute({
      sql: "UPDATE payment_transactions SET status='confirmed',tx_hash=?,confirmed_at=CURRENT_TIMESTAMP WHERE id=? AND telegram_id=? AND status='pending'",
      args: [String(foundTx.transaction_id.hash), id, String(user.id)],
    });
    if (Number(changed.rowsAffected) !== 1) {
      const current = await db.execute({ sql: 'SELECT status,tx_hash FROM payment_transactions WHERE id=? AND telegram_id=?', args: [id, String(user.id)] });
      const latest = current.rows[0];
      return NextResponse.json({ payment: { id, status: String(latest?.status ?? 'pending'), txHash: latest?.tx_hash ? String(latest.tx_hash) : null } });
    }
    return NextResponse.json({ payment: { id, status: 'confirmed', txHash: String(foundTx.transaction_id.hash) } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('withdrawal_fee_verification_failed', e);
    return error('withdrawal_fee_verification_unavailable', 503);
  }
}
