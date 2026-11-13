import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const COINS_PER_LITER = 5;

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function weekKey(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function POST(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required', 401);
  let body: { idempotencyKey?: unknown };
  try { body = await req.json(); } catch { return fail('invalid_body'); }
  const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) return fail('invalid_idempotency_key');

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const id = String(user.id);
    const tx = await db.transaction('write');
    try {
      const previous = await tx.execute({
        sql: 'SELECT metadata_json FROM ledger_entries WHERE telegram_id=? AND idempotency_key=?',
        args: [id, `oil_sale:${key}:coins`],
      });
      if (previous.rows.length) {
        const wallet = await tx.execute({ sql: 'SELECT oil_balance, coins_balance FROM player_wallets WHERE telegram_id=?', args: [id] });
        await tx.commit();
        const w = wallet.rows[0];
        const metadata = JSON.parse(String(previous.rows[0].metadata_json ?? '{}')) as { sold?: number; coinsEarned?: number };
        return NextResponse.json({ duplicate: true, sold: Number(metadata.sold ?? 0), coinsEarned: Number(metadata.coinsEarned ?? 0), wallet: { oil: Number(w?.oil_balance ?? 0), coins: Number(w?.coins_balance ?? 0) } }, { headers: { 'Cache-Control': 'no-store' } });
      }

      const player = await tx.execute({ sql: "SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'", args: [id] });
      if (!player.rows.length) { await tx.rollback(); return fail('player_not_active', 403); }
      const wallet = await tx.execute({ sql: 'SELECT oil_balance, coins_balance FROM player_wallets WHERE telegram_id=?', args: [id] });
      if (!wallet.rows.length) { await tx.rollback(); return fail('wallet_not_found', 404); }
      const sold = Number(wallet.rows[0].oil_balance);
      const oldCoins = Number(wallet.rows[0].coins_balance);
      if (!Number.isSafeInteger(sold) || sold <= 0) { await tx.rollback(); return fail('no_oil_to_sell', 409); }
      const coinsEarned = sold * COINS_PER_LITER;
      const newCoins = oldCoins + coinsEarned;
      if (!Number.isSafeInteger(coinsEarned) || !Number.isSafeInteger(newCoins)) { await tx.rollback(); return fail('invalid_sale_amount', 400); }

      await tx.execute({
        sql: 'UPDATE player_wallets SET oil_balance=0, coins_balance=?, lifetime_coins_earned=lifetime_coins_earned+?, lifetime_oil_sold=lifetime_oil_sold+?, updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
        args: [newCoins, coinsEarned, sold, id],
      });
      const saleId = randomUUID();
      const metadata = JSON.stringify({ saleId, sold, coinsEarned });
      // Oil production is still synchronized through the game snapshot until
      // it has a dedicated server-side pump ledger. The sale is recorded in
      // player_events; only the newly earned coins enter the immutable ledger.
      await tx.execute({
        sql: `INSERT INTO ledger_entries
          (id, telegram_id, asset, entry_type, amount, balance_after, reference_type, reference_id, idempotency_key, metadata_json)
          VALUES (?, ?, 'coins', 'oil_sale', ?, ?, 'oil_sale', ?, ?, ?)`,
        args: [randomUUID(), id, coinsEarned, newCoins, saleId, `oil_sale:${key}:coins`, metadata],
      });

      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      const week = weekKey(now);
      await tx.execute({
        sql: `INSERT INTO player_daily_stats(telegram_id, day_key, sells, oil_sold, coins_earned)
              VALUES (?, ?, 1, ?, ?) ON CONFLICT(telegram_id, day_key) DO UPDATE SET
              sells=sells+1, oil_sold=oil_sold+excluded.oil_sold,
              coins_earned=coins_earned+excluded.coins_earned, updated_at=CURRENT_TIMESTAMP`,
        args: [id, day, sold, coinsEarned],
      });
      await tx.execute({
        sql: `INSERT INTO player_monthly_stats(telegram_id, month_key, sells, oil_sold, coins_earned)
              VALUES (?, ?, 1, ?, ?) ON CONFLICT(telegram_id, month_key) DO UPDATE SET
              sells=sells+1, oil_sold=oil_sold+excluded.oil_sold,
              coins_earned=coins_earned+excluded.coins_earned, updated_at=CURRENT_TIMESTAMP`,
        args: [id, month, sold, coinsEarned],
      });
      await tx.execute({
        sql: `INSERT INTO player_weekly_stats(telegram_id, week_key, sells, oil_sold)
              VALUES (?, ?, 1, ?) ON CONFLICT(telegram_id, week_key) DO UPDATE SET
              sells=sells+1, oil_sold=oil_sold+excluded.oil_sold, updated_at=CURRENT_TIMESTAMP`,
        args: [id, week, sold],
      });
      await tx.execute({
        sql: `INSERT INTO player_events(id, telegram_id, event_type, amount, metadata_json, idempotency_key)
              VALUES (?, ?, 'oil_sale', ?, ?, ?)`,
        args: [randomUUID(), id, coinsEarned, metadata, `event:oil_sale:${key}`],
      });

      await tx.commit();
      return NextResponse.json({ ok: true, saleId, sold, coinsEarned, wallet: { oil: 0, coins: newCoins } }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    console.error('oil_sale_failed', error);
    return fail('oil_sale_failed', 503);
  }
}
