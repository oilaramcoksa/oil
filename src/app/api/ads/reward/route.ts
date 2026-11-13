import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REWARDED_WIDGET_ID = 13283;
const REWARD_COINS = 100;
const CYCLE_LIMIT = 10;
const CYCLE_HOURS = 12;

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function ensureAdCycleTable() {
  const db = getTurso();
  await db.execute(`CREATE TABLE IF NOT EXISTS ad_reward_cycles (
    telegram_id TEXT PRIMARY KEY REFERENCES players(telegram_id) ON DELETE CASCADE,
    views INTEGER NOT NULL DEFAULT 0 CHECK(views >= 0 AND views <= 10),
    cooldown_until TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

function cycleResponse(used: number, cooldownUntilMs: number | null) {
  const locked = cooldownUntilMs !== null && cooldownUntilMs > Date.now();
  return {
    used: locked ? CYCLE_LIMIT : used,
    limit: CYCLE_LIMIT,
    remaining: locked ? 0 : Math.max(0, CYCLE_LIMIT - used),
    cooldownUntil: locked ? cooldownUntilMs : null,
    locked,
    rewardPerAd: REWARD_COINS,
    totalCycleReward: CYCLE_LIMIT * REWARD_COINS,
  };
}

export async function GET(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema();
    await ensureAdCycleTable();
    const db = getTurso();
    // Start a fresh cycle automatically once the 12-hour lock has expired.
    await db.execute({
      sql: `UPDATE ad_reward_cycles
        SET views=0, cooldown_until=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE telegram_id=? AND cooldown_until IS NOT NULL AND datetime(cooldown_until) <= datetime('now')`,
      args: [String(user.id)],
    });
    const result = await db.execute({
      sql: `SELECT views, CASE WHEN cooldown_until IS NOT NULL AND datetime(cooldown_until) > datetime('now')
        THEN CAST(strftime('%s', cooldown_until) AS INTEGER) * 1000 ELSE NULL END AS cooldown_until_ms
        FROM ad_reward_cycles WHERE telegram_id=?`,
      args: [String(user.id)],
    });
    const used = Number(result.rows[0]?.views ?? 0);
    const cooldown = result.rows[0]?.cooldown_until_ms;
    return NextResponse.json(cycleResponse(used, cooldown == null ? null : Number(cooldown)), {
      headers: { 'Cache-Control': 'no-store, private' },
    });
  } catch (error) {
    console.error('tads_ad_progress_failed', error);
    return fail('ad_reward_unavailable', 503);
  }
}

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
    await ensureAdCycleTable();
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
        const cycle = await tx.execute({
          sql: `SELECT views, CASE WHEN cooldown_until IS NOT NULL AND datetime(cooldown_until) > datetime('now')
            THEN CAST(strftime('%s', cooldown_until) AS INTEGER) * 1000 ELSE NULL END AS cooldown_until_ms
            FROM ad_reward_cycles WHERE telegram_id=?`,
          args: [telegramId],
        });
        await tx.commit();
        const used = Number(cycle.rows[0]?.views ?? 0);
        const cooldown = cycle.rows[0]?.cooldown_until_ms;
        return NextResponse.json({
          ok: true, duplicate: true, reward: Number(previous.rows[0].reward_coins),
          wallet: { coins: Number(wallet.rows[0]?.coins_balance ?? 0) },
          cycle: cycleResponse(used, cooldown == null ? null : Number(cooldown)),
        }, { headers: { 'Cache-Control': 'no-store' } });
      }

      const player = await tx.execute({
        sql: "SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'",
        args: [telegramId],
      });
      if (!player.rows.length) { await tx.rollback(); return fail('player_not_active', 403); }

      await tx.execute({
        sql: 'INSERT OR IGNORE INTO ad_reward_cycles(telegram_id, views) VALUES (?, 0)',
        args: [telegramId],
      });
      let cycle = await tx.execute({
        sql: 'SELECT views, cooldown_until FROM ad_reward_cycles WHERE telegram_id=?',
        args: [telegramId],
      });
      let used = Number(cycle.rows[0]?.views ?? 0);
      const cooldownUntil = cycle.rows[0]?.cooldown_until;
      if (cooldownUntil) {
        const activeCooldown = await tx.execute({
          sql: "SELECT CASE WHEN datetime(?) > datetime('now') THEN 1 ELSE 0 END AS active",
          args: [String(cooldownUntil)],
        });
        if (Number(activeCooldown.rows[0]?.active ?? 0) === 1) {
          const until = await tx.execute({
            sql: "SELECT CAST(strftime('%s', ?) AS INTEGER) * 1000 AS cooldown_until_ms",
            args: [String(cooldownUntil)],
          });
          await tx.rollback();
          return NextResponse.json({
            error: 'ad_cycle_cooldown',
            cycle: cycleResponse(CYCLE_LIMIT, Number(until.rows[0]?.cooldown_until_ms)),
          }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
        }
        await tx.execute({
          sql: "UPDATE ad_reward_cycles SET views=0, cooldown_until=NULL, updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?",
          args: [telegramId],
        });
        used = 0;
      }

      if (used >= CYCLE_LIMIT) {
        await tx.rollback();
        return fail('ad_cycle_limit_reached', 429);
      }

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

      const completedViews = used + 1;
      const completesCycle = completedViews === CYCLE_LIMIT;
      await tx.execute({
        sql: 'INSERT INTO ad_reward_claims(id, telegram_id, claim_id, widget_id, reward_coins) VALUES (?, ?, ?, ?, ?)',
        args: [randomUUID(), telegramId, claimId, REWARDED_WIDGET_ID, REWARD_COINS],
      });
      await tx.execute({
        sql: `UPDATE ad_reward_cycles SET views=?,
          cooldown_until=CASE WHEN ?=1 THEN datetime('now', '+12 hours') ELSE NULL END,
          updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?`,
        args: [completedViews, completesCycle ? 1 : 0, telegramId],
      });
      await tx.execute({
        sql: 'UPDATE player_wallets SET coins_balance=?, lifetime_coins_earned=lifetime_coins_earned+?, updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
        args: [newCoins, REWARD_COINS, telegramId],
      });

      const claimRowId = randomUUID();
      const metadata = JSON.stringify({
        widgetId: REWARDED_WIDGET_ID, claimId, reward: REWARD_COINS,
        cycleView: completedViews, cycleLimit: CYCLE_LIMIT, cycleHours: CYCLE_HOURS,
      });
      // The reward claim row above is uniquely keyed by claim_id. Link the ledger to this claim.
      const claim = await tx.execute({
        sql: 'SELECT id FROM ad_reward_claims WHERE telegram_id=? AND claim_id=?',
        args: [telegramId, claimId],
      });
      const savedClaimId = String(claim.rows[0]?.id ?? claimRowId);
      await tx.execute({
        sql: `INSERT INTO ledger_entries
          (id, telegram_id, asset, entry_type, amount, balance_after, reference_type, reference_id, idempotency_key, metadata_json)
          VALUES (?, ?, 'coins', 'tads_ad_reward', ?, ?, 'tads_ad', ?, ?, ?)`,
        args: [randomUUID(), telegramId, REWARD_COINS, newCoins, savedClaimId, `tads_ad_reward:${telegramId}:${claimId}`, metadata],
      });
      await tx.execute({
        sql: `INSERT INTO player_events(id, telegram_id, event_type, amount, metadata_json, idempotency_key)
          VALUES (?, ?, 'tads_ad_reward', ?, ?, ?)`,
        args: [randomUUID(), telegramId, REWARD_COINS, metadata, `event:tads_ad_reward:${telegramId}:${claimId}`],
      });

      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      const yearWeekDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const weekday = yearWeekDate.getUTCDay() || 7;
      yearWeekDate.setUTCDate(yearWeekDate.getUTCDate() + 4 - weekday);
      const yearStart = new Date(Date.UTC(yearWeekDate.getUTCFullYear(), 0, 1));
      const week = `${yearWeekDate.getUTCFullYear()}-W${String(Math.ceil(((yearWeekDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)).padStart(2, '0')}`;
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

      const cooldownResult = completesCycle
        ? await tx.execute({ sql: "SELECT CAST(strftime('%s', datetime('now', '+12 hours')) AS INTEGER) * 1000 AS ms" })
        : { rows: [{ ms: null }] };
      await tx.commit();
      return NextResponse.json({
        ok: true, duplicate: false, reward: REWARD_COINS, baseReward: REWARD_COINS,
        wallet: { coins: newCoins },
        cycle: cycleResponse(completedViews, cooldownResult.rows[0]?.ms == null ? null : Number(cooldownResult.rows[0].ms)),
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
