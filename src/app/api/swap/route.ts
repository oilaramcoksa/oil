import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MICRO_USD_PER_COIN = 10; // 100,000 coins = 1 USD

function errorJson(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return errorJson('telegram_auth_required', 401);
  let body: { coins?: unknown; idempotencyKey?: unknown };
  try { body = await req.json(); } catch { return errorJson('invalid_body'); }
  const coins = Number(body.coins);
  const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
  if (!Number.isSafeInteger(coins) || coins < 1 || coins > 1_000_000_000_000) return errorJson('invalid_amount');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) return errorJson('invalid_idempotency_key');
  const id = String(user.id);
  const usdMicros = coins * MICRO_USD_PER_COIN;
  if (!Number.isSafeInteger(usdMicros)) return errorJson('invalid_amount');
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const tx = await db.transaction('write');
    try {
      const prior = await tx.execute({ sql: 'SELECT id, coins, usd_micros FROM coin_swaps WHERE idempotency_key=?', args: [key] });
      if (prior.rows.length) {
        const wallet = await tx.execute({ sql: 'SELECT coins_balance, usd_micros FROM player_wallets WHERE telegram_id=?', args: [id] });
        await tx.commit();
        return NextResponse.json({ duplicate: true, wallet: wallet.rows[0] ? { coins: Number(wallet.rows[0].coins_balance), usdMicros: Number(wallet.rows[0].usd_micros) } : null });
      }
      const player = await tx.execute({ sql: "SELECT status FROM players WHERE telegram_id=?", args: [id] });
      if (!player.rows.length || player.rows[0].status !== 'active') { await tx.rollback(); return errorJson('player_not_active', 403); }
      const debit = await tx.execute({
        sql: 'UPDATE player_wallets SET coins_balance=coins_balance-?, usd_micros=usd_micros+?, updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND coins_balance>=?',
        args: [coins, usdMicros, id, coins],
      });
      if (Number(debit.rowsAffected) !== 1) { await tx.rollback(); return errorJson('insufficient_balance', 409); }
      const swapId = randomUUID();
      await tx.execute({
        sql: 'INSERT INTO coin_swaps(id, telegram_id, coins, usd_micros, idempotency_key) VALUES(?,?,?,?,?)',
        args: [swapId, id, coins, usdMicros, key],
      });
      // Record the debit in the immutable ledger so cloud snapshot sync
      // can never restore these already-converted coins.
      await tx.execute({
        sql: `INSERT INTO ledger_entries
          (id, telegram_id, asset, entry_type, amount, balance_after, reference_type, reference_id, idempotency_key, metadata_json)
          VALUES (?, ?, 'coins', 'coin_swap', ?, ?, 'coin_swap', ?, ?, ?)`,
        args: [randomUUID(), id, -coins, Number((await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [id] })).rows[0].coins_balance), swapId, `coin_swap:${swapId}`, JSON.stringify({ coins, usdMicros })],
      });
      const wallet = await tx.execute({ sql: 'SELECT coins_balance, usd_micros FROM player_wallets WHERE telegram_id=?', args: [id] });
      await tx.commit();
      const w = wallet.rows[0];
      return NextResponse.json({ swap: { id: swapId, coins, usdMicros }, wallet: { coins: Number(w.coins_balance), usdMicros: Number(w.usd_micros) } }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (e) {
    console.error('coin_swap_failed', e);
    return errorJson('server_error', 503);
  }
}
