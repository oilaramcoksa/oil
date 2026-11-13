import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REWARD_COINS = 100;
const ADSGRAM_LIMIT = 20;
const TADS_LIMIT = 10;
const CYCLE_LIMIT = ADSGRAM_LIMIT + TADS_LIMIT;
const CYCLE_HOURS = 12;
const CYCLE_TABLE = 'ad_reward_cycles_v2';

function reply(ok: boolean, status = 200, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function secretMatches(received: string | null, expected: string | undefined) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ensureCycleTable() {
  const db = getTurso();
  await db.execute(`CREATE TABLE IF NOT EXISTS ad_reward_cycles (
    telegram_id TEXT PRIMARY KEY REFERENCES players(telegram_id) ON DELETE CASCADE,
    views INTEGER NOT NULL DEFAULT 0 CHECK(views >= 0 AND views <= 10),
    cooldown_until TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS ${CYCLE_TABLE} (
    telegram_id TEXT PRIMARY KEY REFERENCES players(telegram_id) ON DELETE CASCADE,
    views INTEGER NOT NULL DEFAULT 0 CHECK(views >= 0 AND views <= 30),
    adsgram_views INTEGER NOT NULL DEFAULT 0 CHECK(adsgram_views >= 0 AND adsgram_views <= 20),
    tads_views INTEGER NOT NULL DEFAULT 0 CHECK(tads_views >= 0 AND tads_views <= 10),
    cooldown_until TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(`INSERT OR IGNORE INTO ${CYCLE_TABLE}
    (telegram_id, views, adsgram_views, tads_views, cooldown_until, updated_at)
    SELECT telegram_id, views, 0, 0, cooldown_until, updated_at FROM ad_reward_cycles`);
}

export async function GET(req: NextRequest) {
  const configuredSecret = process.env.ADSGRAM_TASK_WEBHOOK_SECRET;
  if (!secretMatches(req.nextUrl.searchParams.get('key'), configuredSecret)) {
    return reply(false, 401, { error: 'unauthorized' });
  }

  const telegramId = req.nextUrl.searchParams.get('userId') ?? req.nextUrl.searchParams.get('userid');
  if (!telegramId || !/^\d{5,20}$/.test(telegramId)) {
    return reply(false, 400, { error: 'invalid_user_id' });
  }

  try {
    await ensureDatabaseSchema();
    await ensureCycleTable();
    const db = getTurso();
    const tx = await db.transaction('write');
    try {
      const player = await tx.execute({
        sql: "SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'",
        args: [telegramId],
      });
      if (!player.rows.length) {
        await tx.rollback();
        return reply(false, 404, { error: 'player_not_found_or_inactive' });
      }

      await tx.execute({
        sql: `INSERT OR IGNORE INTO ${CYCLE_TABLE}(telegram_id) VALUES (?)`,
        args: [telegramId],
      });
      const cycle = await tx.execute({
        sql: `SELECT views, adsgram_views, tads_views, cooldown_until
          FROM ${CYCLE_TABLE} WHERE telegram_id=?`,
        args: [telegramId],
      });
      let views = Number(cycle.rows[0]?.views ?? 0);
      let adsgramViews = Number(cycle.rows[0]?.adsgram_views ?? 0);
      let tadsViews = Number(cycle.rows[0]?.tads_views ?? 0);
      const cooldownUntil = cycle.rows[0]?.cooldown_until;

      if (cooldownUntil) {
        const active = await tx.execute({
          sql: "SELECT CASE WHEN datetime(?) > datetime('now') THEN 1 ELSE 0 END AS active",
          args: [String(cooldownUntil)],
        });
        if (Number(active.rows[0]?.active ?? 0) === 1) {
          await tx.rollback();
          return reply(false, 429, { error: 'cycle_locked' });
        }
        await tx.execute({
          sql: `UPDATE ${CYCLE_TABLE}
            SET views=0, adsgram_views=0, tads_views=0, cooldown_until=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE telegram_id=?`,
          args: [telegramId],
        });
        views = 0; adsgramViews = 0; tadsViews = 0;
      }

      if (views >= CYCLE_LIMIT || adsgramViews >= ADSGRAM_LIMIT) {
        await tx.rollback();
        return reply(false, 429, { error: 'adsgram_quota_reached' });
      }

      // AdsGram's documented Task postback supplies userId but no event ID.
      // A one-minute idempotency bucket prevents immediate duplicate callbacks.
      const minuteBucket = Math.floor(Date.now() / 60000);
      const claimId = `adsgram-task-${createHash('sha256').update(`${telegramId}:${minuteBucket}`).digest('hex').slice(0, 40)}`;
      const prior = await tx.execute({
        sql: 'SELECT reward_coins FROM ad_reward_claims WHERE telegram_id=? AND claim_id=?',
        args: [telegramId, claimId],
      });
      if (prior.rows.length) {
        await tx.commit();
        return reply(true, 200, { duplicate: true, reward: Number(prior.rows[0].reward_coins) });
      }

      const wallet = await tx.execute({
        sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',
        args: [telegramId],
      });
      if (!wallet.rows.length) {
        await tx.rollback();
        return reply(false, 404, { error: 'wallet_not_found' });
      }
      const oldCoins = Number(wallet.rows[0].coins_balance);
      const newCoins = oldCoins + REWARD_COINS;
      if (!Number.isSafeInteger(oldCoins) || oldCoins < 0 || !Number.isSafeInteger(newCoins)) {
        await tx.rollback();
        return reply(false, 409, { error: 'invalid_wallet_balance' });
      }

      const nextViews = views + 1;
      const nextAdsgram = adsgramViews + 1;
      const completesCycle = nextViews === CYCLE_LIMIT;
      const claimRowId = randomUUID();
      await tx.execute({
        sql: 'INSERT INTO ad_reward_claims(id, telegram_id, claim_id, widget_id, reward_coins) VALUES (?, ?, ?, ?, ?)',
        args: [claimRowId, telegramId, claimId, 0, REWARD_COINS],
      });
      await tx.execute({
        sql: `UPDATE ${CYCLE_TABLE} SET views=?, adsgram_views=?,
          cooldown_until=CASE WHEN ?=1 THEN datetime('now', '+12 hours') ELSE NULL END,
          updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?`,
        args: [nextViews, nextAdsgram, completesCycle ? 1 : 0, telegramId],
      });
      await tx.execute({
        sql: 'UPDATE player_wallets SET coins_balance=?, lifetime_coins_earned=lifetime_coins_earned+?, updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
        args: [newCoins, REWARD_COINS, telegramId],
      });

      const metadata = JSON.stringify({
        provider: 'adsgram_task_webhook',
        blockType: 'task',
        claimId,
        reward: REWARD_COINS,
        cycleView: nextViews,
        adsgramViews: nextAdsgram,
        tadsViews,
        cycleLimit: CYCLE_LIMIT,
        cycleHours: CYCLE_HOURS,
      });
      await tx.execute({
        sql: `INSERT INTO ledger_entries
          (id, telegram_id, asset, entry_type, amount, balance_after, reference_type, reference_id, idempotency_key, metadata_json)
          VALUES (?, ?, 'coins', 'adsgram_task_reward', ?, ?, 'adsgram_task', ?, ?, ?)`,
        args: [randomUUID(), telegramId, REWARD_COINS, newCoins, claimRowId, `adsgram_task:${telegramId}:${claimId}`, metadata],
      });
      await tx.execute({
        sql: `INSERT INTO player_events(id, telegram_id, event_type, amount, metadata_json, idempotency_key)
          VALUES (?, ?, 'adsgram_task_reward', ?, ?, ?)`,
        args: [randomUUID(), telegramId, REWARD_COINS, metadata, `event:adsgram_task:${telegramId}:${claimId}`],
      });

      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      const weekDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const weekday = weekDate.getUTCDay() || 7;
      weekDate.setUTCDate(weekDate.getUTCDate() + 4 - weekday);
      const yearStart = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 1));
      const week = `${weekDate.getUTCFullYear()}-W${String(Math.ceil(((weekDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)).padStart(2, '0')}`;
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
      return reply(true, 200, { reward: REWARD_COINS, cycleViews: nextViews, adsgramViews: nextAdsgram, remainingAdsgram: ADSGRAM_LIMIT - nextAdsgram });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    console.error('adsgram_task_webhook_failed', error);
    return reply(false, 503, { error: 'reward_processing_failed' });
  }
}
