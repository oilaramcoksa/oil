import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REWARDED_WIDGET_ID = 13283;
const REWARD_COINS = 100;
const MAX_DAILY_REWARDS = 20;
const MIN_REWARD_INTERVAL_SECONDS = 30;

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

/**
 * The TADS onShowReward callback is emitted by the SDK after a rewarded
 * fullscreen view. Telegram initData authenticates the player; this endpoint
 * additionally enforces a server-side daily cap, cooldown and idempotency.
 * The callback itself is a client signal, not cryptographic proof from TADS.
 */
export async function POST(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required', 401);

  let body: { widgetId?: unknown; claimId?: unknown };
  try { body = await req.json(); } catch { return fail('invalid_body'); }

  if (body.widgetId !== REWARDED_WIDGET_ID) return fail('invalid_reward_widget', 400);
  const claimId = typeof body.claimId === 'string' ? body.claimId : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claimId)) {
    return fail('invalid_claim_id', 400);
  }

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const telegramId = String(user.id);
    const tx = await db.transaction('write');
    try {
      const previous = await tx.execute({
        sql: 'SELECT reward_coins FROM ad_reward_claims WHERE telegram_id=? AND claim_id=?',
        args: [telegramId, claimId],
      });
      if (previous.rows.length) {
        const wallet = await tx.execute({
          sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',
          args: [telegramId],
        });
        await tx.commit();
        return NextResponse.json({
          ok: true, duplicate: true, reward: Number(previous.rows[0].reward_coins),
          wallet: { coins: Number(wallet.rows[0]?.coins_balance ?? 0) },
        }, { headers: { 'Cache-Control': 'no-store' } });
      }

      const player = await tx.execute({
        sql: "SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'",
        args: [telegramId],
      });
      if (!player.rows.length) { await tx.rollback(); return fail('player_not_active', 403); }

      const wallet = await tx.execute({
        sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',
        args: [telegramId],
      });
      if (!wallet.rows.length) { await tx.rollback(); return fail('wallet_not_found', 404); }
      const oldCoins = Number(wallet.rows[0].coins_balance);
      const newCoins = oldCoins + REWARD_COINS;
      if (!Number.isSafeInteger(oldCoins) || oldCoins < 0 || !Number.isSafeInteger(newCoins)) {
        await tx.rollback();
        return fail('invalid_wallet_balance', 409);
      }

      const daily = await tx.execute({
        sql: "SELECT COUNT(*) AS total FROM ad_reward_claims WHERE telegram_id=? AND date(created_at)=date('now')",
        args: [telegramId],
      });
      if (Number(daily.rows[0]?.total ?? 0) >= MAX_DAILY_REWARDS) {
        await tx.rollback();
        return fail('daily_reward_limit_reached', 429);
      }

      const recent = await tx.execute({
        sql: "SELECT id FROM ad_reward_claims WHERE telegram_id=? AND created_at >= datetime('now', ? ) LIMIT 1",
        args: [telegramId, `-${MIN_REWARD_INTERVAL_SECONDS} seconds`],
      });
      if (recent.rows.length) {
        await tx.rollback();
        return fail('reward_cooldown', 429);
      }

      const claimRowId = randomUUID();
      const metadata = JSON.stringify({ widgetId: REWARDED_WIDGET_ID, claimId, reward: REWARD_COINS });
      await tx.execute({
        sql: 'INSERT INTO ad_reward_claims(id, telegram_id, claim_id, widget_id, reward_coins) VALUES (?, ?, ?, ?, ?)',
        args: [claimRowId, telegramId, claimId, REWARDED_WIDGET_ID, REWARD_COINS],
      });
      await tx.execute({
        sql: 'UPDATE player_wallets SET coins_balance=?, lifetime_coins_earned=lifetime_coins_earned+?, updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
        args: [newCoins, REWARD_COINS, telegramId],
      });
      await tx.execute({
        sql: `INSERT INTO ledger_entries
          (id, telegram_id, asset, entry_type, amount, balance_after, reference_type, reference_id, idempotency_key, metadata_json)
          VALUES (?, ?, 'coins', 'tads_ad_reward', ?, ?, 'tads_ad', ?, ?, ?)`,
        args: [randomUUID(), telegramId, REWARD_COINS, newCoins, claimRowId, `tads_ad_reward:${telegramId}:${claimId}`, metadata],
      });
      await tx.execute({
        sql: `INSERT INTO player_events(id, telegram_id, event_type, amount, metadata_json, idempotency_key)
          VALUES (?, ?, 'tads_ad_reward', ?, ?, ?)`,
        args: [randomUUID(), telegramId, REWARD_COINS, metadata, `event:tads_ad_reward:${telegramId}:${claimId}`],
      });

      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      const week = weekKey(now);
      await tx.execute({
        sql: `INSERT INTO player_daily_stats(telegram_id, day_key, coins_earned)
          VALUES (?, ?, ?) ON CONFLICT(telegram_id, day_key) DO UPDATE SET
          coins_earned=coins_earned+excluded.coins_earned, updated_at=CURRENT_TIMESTAMP`,
        args: [telegramId, day, REWARD_COINS],
      });
      await tx.execute({
        sql: `INSERT INTO player_monthly_stats(telegram_id, month_key, coins_earned)
          VALUES (?, ?, ?) ON CONFLICT(telegram_id, month_key) DO UPDATE SET
          coins_earned=coins_earned+excluded.coins_earned, updated_at=CURRENT_TIMESTAMP`,
        args: [telegramId, month, REWARD_COINS],
      });
      await tx.execute({
        sql: `INSERT INTO player_weekly_stats(telegram_id, week_key, coins_earned)
          VALUES (?, ?, ?) ON CONFLICT(telegram_id, week_key) DO UPDATE SET
          coins_earned=coins_earned+excluded.coins_earned, updated_at=CURRENT_TIMESTAMP`,
        args: [telegramId, week, REWARD_COINS],
      });

      await tx.commit();
      return NextResponse.json({
        ok: true, duplicate: false, reward: REWARD_COINS,
        wallet: { coins: newCoins },
        daily: { used: Number(daily.rows[0]?.total ?? 0) + 1, limit: MAX_DAILY_REWARDS },
      }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    console.error('tads_ad_reward_failed', error);
    return fail('ad_reward_unavailable', 503);
  }
}
