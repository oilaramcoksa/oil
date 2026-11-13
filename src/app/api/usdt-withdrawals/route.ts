import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MIN_WITHDRAWAL_MICROS = 1_000_000;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function errorJson(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return errorJson('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const id = String(user.id);
    const [wallet, history] = await Promise.all([
      db.execute({ sql: 'SELECT coins_balance, usd_micros FROM player_wallets WHERE telegram_id=?', args: [id] }),
      db.execute({ sql: 'SELECT id, usd_micros, tron_address, status, tx_hash, admin_note, created_at, updated_at FROM usdt_withdrawal_requests WHERE telegram_id=? ORDER BY created_at DESC LIMIT 50', args: [id] }),
    ]);
    const w = wallet.rows[0];
    return NextResponse.json({
      wallet: w ? { coins: Number(w.coins_balance), usdMicros: Number(w.usd_micros) } : { coins: 0, usdMicros: 0 },
      withdrawals: history.rows.map(row => ({
        id: String(row.id), usdMicros: Number(row.usd_micros), tronAddress: String(row.tron_address),
        status: String(row.status), txHash: row.tx_hash ? String(row.tx_hash) : null,
        adminNote: row.admin_note ? String(row.admin_note) : null,
        createdAt: Date.parse(String(row.created_at)) || 0, updatedAt: Date.parse(String(row.updated_at)) || 0,
      })),
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (e) { console.error('usdt_withdrawal_history_failed', e); return errorJson('server_error', 503); }
}

export async function POST(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return errorJson('telegram_auth_required', 401);
  let body: { amountUsd?: unknown; tronAddress?: unknown; idempotencyKey?: unknown };
  try { body = await req.json(); } catch { return errorJson('invalid_body'); }
  const amount = Number(body.amountUsd);
  const micros = Math.round(amount * 1_000_000);
  const address = typeof body.tronAddress === 'string' ? body.tronAddress.trim() : '';
  const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
  if (!Number.isFinite(amount) || !Number.isSafeInteger(micros) || micros < MIN_WITHDRAWAL_MICROS || Math.abs(amount - micros / 1_000_000) > 0.0000001) return errorJson('minimum_one_usd');
  if (!TRON_ADDRESS.test(address)) return errorJson('invalid_tron_address');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) return errorJson('invalid_idempotency_key');
  const id = String(user.id);
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const tx = await db.transaction('write');
    try {
      const previous = await tx.execute({ sql: 'SELECT id, usd_micros, tron_address, status, created_at FROM usdt_withdrawal_requests WHERE idempotency_key=?', args: [key] });
      if (previous.rows.length) {
        const wallet = await tx.execute({ sql: 'SELECT coins_balance, usd_micros, usd_locked_micros FROM player_wallets WHERE telegram_id=?', args: [id] });
        await tx.commit();
        const row = previous.rows[0], w = wallet.rows[0];
        return NextResponse.json({ duplicate: true, withdrawal: { id: String(row.id), usdMicros: Number(row.usd_micros), tronAddress: String(row.tron_address), status: String(row.status) }, wallet: w ? { coins: Number(w.coins_balance), usdMicros: Number(w.usd_micros), usdLockedMicros: Number(w.usd_locked_micros) } : null });
      }
      const player = await tx.execute({ sql: "SELECT status FROM players WHERE telegram_id=?", args: [id] });
      if (!player.rows.length || player.rows[0].status !== 'active') { await tx.rollback(); return errorJson('player_not_active', 403); }
      const debit = await tx.execute({
        sql: 'UPDATE player_wallets SET usd_micros=usd_micros-?, usd_locked_micros=usd_locked_micros+?, updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND usd_micros>=?',
        args: [micros, micros, id, micros],
      });
      if (Number(debit.rowsAffected) !== 1) { await tx.rollback(); return errorJson('insufficient_usd_balance', 409); }
      const withdrawalId = randomUUID();
      await tx.execute({
        sql: 'INSERT INTO usdt_withdrawal_requests(id, telegram_id, usd_micros, tron_address, idempotency_key) VALUES(?,?,?,?,?)',
        args: [withdrawalId, id, micros, address, key],
      });
      const wallet = await tx.execute({ sql: 'SELECT coins_balance, usd_micros, usd_locked_micros FROM player_wallets WHERE telegram_id=?', args: [id] });
      await tx.commit();
      const w = wallet.rows[0];
      return NextResponse.json({
        withdrawal: { id: withdrawalId, usdMicros: micros, tronAddress: address, status: 'pending', createdAt: Date.now() },
        wallet: { coins: Number(w.coins_balance), usdMicros: Number(w.usd_micros), usdLockedMicros: Number(w.usd_locked_micros) },
      }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (e) { console.error('usdt_withdrawal_create_failed', e); return errorJson('server_error', 503); }
}
