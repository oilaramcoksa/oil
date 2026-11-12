import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { getVerifiedTelegramUser } from '@/lib/telegram-auth';
import { COINS_PER_USD, MIN_UNITS, MAX_UNITS_PER_REQUEST, isValidTonAddress } from '@/lib/withdraw';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  const user = getVerifiedTelegramUser(req);
  if (!user) return jsonError('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const [rows, wallet] = await Promise.all([
      db.execute({
        sql: `SELECT id, units, coins, ton_address, status, tx_hash, admin_note, created_at, updated_at
              FROM withdrawal_requests WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 50`,
        args: [String(user.id)],
      }),
      db.execute({ sql: 'SELECT coins_balance, coins_locked, oil_balance FROM player_wallets WHERE telegram_id = ?', args: [String(user.id)] }),
    ]);
    const withdrawals = rows.rows.map((row) => ({
      id: String(row.id), units: Number(row.units), coins: Number(row.coins), usd: Number(row.units),
      tonAddress: String(row.ton_address), status: String(row.status),
      txHash: row.tx_hash ? String(row.tx_hash) : null,
      adminNote: row.admin_note ? String(row.admin_note) : null,
      createdAt: Date.parse(String(row.created_at)) || 0,
      updatedAt: Date.parse(String(row.updated_at)) || 0,
    }));
    const w = wallet.rows[0];
    return NextResponse.json({
      withdrawals,
      wallet: w ? { coins: Number(w.coins_balance), coinsLocked: Number(w.coins_locked), oil: Number(w.oil_balance) } : null,
      source: 'turso',
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('withdrawal_history_failed', error);
    return jsonError('withdrawal_history_unavailable', 503);
  }
}

export async function POST(req: NextRequest) {
  const user = getVerifiedTelegramUser(req);
  if (!user) return jsonError('telegram_auth_required', 401);
  let body: { units?: unknown; tonAddress?: unknown; idempotencyKey?: unknown };
  try { body = await req.json(); } catch { return jsonError('invalid_body', 400); }
  const units = Number(body.units);
  const tonAddress = typeof body.tonAddress === 'string' ? body.tonAddress.trim() : '';
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!Number.isSafeInteger(units) || units < MIN_UNITS || units > MAX_UNITS_PER_REQUEST) return jsonError('invalid_units', 400);
  if (!isValidTonAddress(tonAddress)) return jsonError('invalid_ton_address', 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) return jsonError('invalid_idempotency_key', 400);
  const coins = units * COINS_PER_USD;
  const telegramId = String(user.id);

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const tx = await db.transaction('write');
    try {
      // A retry of the same client operation returns the original request and
      // never locks/debits the wallet a second time.
      const previous = await tx.execute({
        sql: `SELECT id, units, coins, ton_address, status, tx_hash, admin_note, created_at, updated_at
              FROM withdrawal_requests WHERE telegram_id = ? AND idempotency_key = ? LIMIT 1`,
        args: [telegramId, idempotencyKey],
      });
      if (previous.rows.length) {
        const row = previous.rows[0];
        const wallet = await tx.execute({
          sql: 'SELECT coins_balance, coins_locked FROM player_wallets WHERE telegram_id = ?',
          args: [telegramId],
        });
        await tx.commit();
        const w = wallet.rows[0];
        return NextResponse.json({
          withdrawal: {
            id: String(row.id), units: Number(row.units), coins: Number(row.coins), usd: Number(row.units),
            tonAddress: String(row.ton_address), status: String(row.status),
            txHash: row.tx_hash ? String(row.tx_hash) : null,
            adminNote: row.admin_note ? String(row.admin_note) : null,
            createdAt: Date.parse(String(row.created_at)) || 0,
            updatedAt: Date.parse(String(row.updated_at)) || 0,
          },
          wallet: w ? { coins: Number(w.coins_balance), coinsLocked: Number(w.coins_locked) } : null,
          source: 'turso',
          duplicate: true,
        }, { headers: { 'Cache-Control': 'no-store' } });
      }

      const player = await tx.execute({ sql: "SELECT status FROM players WHERE telegram_id = ?", args: [telegramId] });
      if (!player.rows.length || player.rows[0].status !== 'active') {
        await tx.rollback();
        return jsonError('player_not_active', 403);
      }
      const debit = await tx.execute({
        sql: `UPDATE player_wallets
              SET coins_balance = coins_balance - ?, coins_locked = coins_locked + ?, updated_at = CURRENT_TIMESTAMP
              WHERE telegram_id = ? AND coins_balance >= ?`,
        args: [coins, coins, telegramId, coins],
      });
      if (Number(debit.rowsAffected) !== 1) {
        await tx.rollback();
        return jsonError('insufficient_balance', 409);
      }
      const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id = ?', args: [telegramId] });
      const balanceAfter = Number(wallet.rows[0]?.coins_balance ?? 0);
      const withdrawalId = randomUUID();
      await tx.execute({
        sql: `INSERT INTO ledger_entries
          (id, telegram_id, asset, entry_type, amount, balance_after, reference_type, reference_id, idempotency_key, metadata_json)
          VALUES (?, ?, 'coins', 'withdrawal_lock', ?, ?, 'withdrawal', ?, ?, ?)`,
        args: [randomUUID(), telegramId, -coins, balanceAfter, withdrawalId, `withdrawal-lock:${withdrawalId}`, JSON.stringify({ units, tonAddress })],
      });
      await tx.execute({
        sql: `INSERT INTO withdrawal_requests(id, telegram_id, units, coins, ton_address, idempotency_key)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [withdrawalId, telegramId, units, coins, tonAddress, idempotencyKey],
      });
      await tx.execute({
        sql: `INSERT INTO player_events(id, telegram_id, event_type, amount, metadata_json, idempotency_key)
              VALUES (?, ?, 'withdrawal_requested', ?, ?, ?)`,
        args: [randomUUID(), telegramId, -coins, JSON.stringify({ withdrawalId, units }), `withdrawal-event:${withdrawalId}`],
      });
      await tx.commit();
      return NextResponse.json({
        withdrawal: { id: withdrawalId, units, coins, usd: units, tonAddress, status: 'pending', createdAt: Date.now(), updatedAt: Date.now() },
        wallet: { coins: balanceAfter, coinsLocked: coins },
        source: 'turso',
        duplicate: false,
      }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    console.error('withdrawal_create_failed', error);
    return jsonError('withdrawal_request_failed', 503);
  }
}
