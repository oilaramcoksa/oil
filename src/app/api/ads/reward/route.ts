import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TADS_REWARDED_WIDGET_ID = 13283;
const ADSGRAM_REWARDED_BLOCK_ID = 59642;
const REWARD_COINS = 100;
const CYCLE_LIMIT = 30;
const ADSGRAM_LIMIT = 20;
const TADS_LIMIT = 10;
const CYCLE_HOURS = 12;
const CYCLE_TABLE = 'ad_reward_cycles_v2';

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function ensureAdCycleTable() {
  const db = getTurso();
  await db.execute(`CREATE TABLE IF NOT EXISTS ${CYCLE_TABLE} (
    telegram_id TEXT PRIMARY KEY REFERENCES players(telegram_id) ON DELETE CASCADE,
    views INTEGER NOT NULL DEFAULT 0 CHECK(views >= 0 AND views <= 30),
    adsgram_views INTEGER NOT NULL DEFAULT 0 CHECK(adsgram_views >= 0 AND adsgram_views <= 20),
    tads_views INTEGER NOT NULL DEFAULT 0 CHECK(tads_views >= 0 AND tads_views <= 10),
    cooldown_until TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // Preserve the old shared counter while moving to the 30-view split quota.
  await db.execute(`INSERT OR IGNORE INTO ${CYCLE_TABLE}
    (telegram_id, views, adsgram_views, tads_views, cooldown_until, updated_at)
    SELECT telegram_id, views, 0, 0, cooldown_until, updated_at FROM ad_reward_cycles`);
}

function cycleResponse(
  used: number,
  adsgramUsed: number,
  tadsUsed: number,
  cooldownUntilMs: number | null,
) {
  const locked = cooldownUntilMs !== null && cooldownUntilMs > Date.now();
  return {
    used: locked ? CYCLE_LIMIT : used,
    limit: CYCLE_LIMIT,
    remaining: locked ? 0 : Math.max(0, CYCLE_LIMIT - used),
    cooldownUntil: locked ? cooldownUntilMs : null,
    locked,
    rewardPerAd: REWARD_COINS,
    totalCycleReward: CYCLE_LIMIT * REWARD_COINS,
    adsgram: { used: locked ? ADSGRAM_LIMIT : adsgramUsed, limit: ADSGRAM_LIMIT, remaining: locked ? 0 : Math.max(0, ADSGRAM_LIMIT - adsgramUsed) },
    tads: { used: locked ? TADS_LIMIT : tadsUsed, limit: TADS_LIMIT, remaining: locked ? 0 : Math.max(0, TADS_LIMIT - tadsUsed) },
  };
}

export async function GET(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema();
    await ensureAdCycleTable();
    const db = getTurso();
    await db.execute({
      sql: `UPDATE ${CYCLE_TABLE}
        SET views=0, adsgram_views=0, tads_views=0, cooldown_until=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE telegram_id=? AND cooldown_until IS NOT NULL AND datetime(cooldown_until) <= datetime('now')`,
      args: [String(user.id)],
    });
    const result = await db.execute({
      sql: `SELECT views, adsgram_views, tads_views,
        CASE WHEN cooldown_until IS NOT NULL AND datetime(cooldown_until) > datetime('now')
        THEN CAST(strftime('%s', cooldown_until) AS INTEGER) * 1000 ELSE NULL END AS cooldown_until_ms
        FROM ${CYCLE_TABLE} WHERE telegram_id=?`,
      args: [String(user.id)],
    });
    const row = result.rows[0];
    return NextResponse.json(cycleResponse(
      Number(row?.views ?? 0), Number(row?.adsgram_views ?? 0), Number(row?.tads_views ?? 0),
      row?.cooldown_until_ms == null ? null : Number(row.cooldown_until_ms),
    ), { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('tads_ad_progress_failed', error);
    return fail('ad_reward_unavailable', 503);
  }
}

export async function POST(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required', 401);

  let body: { widgetId?: unknown; claimId?: unknown; provider?: unknown };
  try { body = await req.json(); } catch { return fail('invalid_body'); }
  const provider = body.provider === 'adsgram' ? 'adsgram' : body.provider === 'tads' || body.provider == null ? 'tads' : null;
  if (!provider) return fail('invalid_ad_provider', 400);
  const expectedWidgetId = provider === 'adsgram' ? ADSGRAM_REWARDED_BLOCK_ID : TADS_REWARDED_WIDGET_ID;
  if (body.widgetId !== expectedWidgetId) return fail('invalid_reward_widget', 400);
  const claimId = typeof body.claimId === 'string' ? body.claimId : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claimId)) return fail('invalid_claim_id');

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
        const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [telegramId] });
        const cycle = await tx.execute({
          sql: `SELECT views, adsgram_views, tads_views,
            CASE WHEN cooldown_until IS NOT NULL AND datetime(cooldown_until) > datetime('now')
            THEN CAST(strftime('%s', cooldown_until) AS INTEGER) * 1000 ELSE NULL END AS cooldown_until_ms
            FROM ${CYCLE_TABLE} WHERE telegram_id=?`,
          args: [telegramId],
        });
        await tx.commit();
        const row = cycle.rows[0];
        return NextResponse.json({
          ok: true, duplicate: true, reward: Number(previous.rows[0].reward_coins),
          wallet: { coins: Number(wallet.rows[0]?.coins_balance ?? 0) },
          cycle: cycleResponse(Number(row?.views ?? 0), Number(row?.adsgram_views ?? 0), Number(row?.tads_views ?? 0), row?.cooldown_until_ms == null ? null : Number(row.cooldown_until_ms)),
        }, { headers: { 'Cache-Control': 'no-store' } });
      }

      const player = await tx.execute({ sql: "SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'", args: [telegramId] });
      if (!player.rows.length) { await tx.rollback(); return fail('player_not_active', 403); }
      await tx.execute({ sql: `INSERT OR IGNORE INTO ${CYCLE_TABLE}(telegram_id) VALUES (?)`, args: [telegramId] });
      let cycle = await tx.execute({ sql: `SELECT views, adsgram_views, tads_views, cooldown_until FROM ${CYCLE_TABLE} WHERE telegram_id=?`, args: [telegramId] });
      let used = Number(cycle.rows[0]?.views ?? 0);
      let adsgramUsed = Number(cycle.rows[0]?.adsgram_views ?? 0);
      let tadsUsed = Number(cycle.rows[0]?.tads_views ?? 0);
      const cooldownUntil = cycle.rows[0]?.cooldown_until;
      if (cooldownUntil) {
        const active = await tx.execute({ sql: "SELECT CASE WHEN datetime(?) > datetime('now') THEN 1 ELSE 0 END AS active", args: [String(cooldownUntil)] });
        if (Number(active.rows[0]?.active ?? 0) === 1) {
          const until = await tx.execute({ sql: "SELECT CAST(strftime('%s', ?) AS INTEGER) * 1000 AS ms", args: [String(cooldownUntil)] });
          await tx.rollback();
          return NextResponse.json({ error: 'ad_cycle_cooldown', cycle: cycleResponse(CYCLE_LIMIT, ADSGRAM_LIMIT, TADS_LIMIT, Number(until.rows[0]?.ms)) }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
        }
        await tx.execute({ sql: `UPDATE ${CYCLE_TABLE} SET views=0, adsgram_views=0, tads_views=0, cooldown_until=NULL, updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?`, args: [telegramId] });
        used = 0; adsgramUsed = 0; tadsUsed = 0;
      }
      const providerUsed = provider === 'adsgram' ? adsgramUsed : tadsUsed;
      const providerLimit = provider === 'adsgram' ? ADSGRAM_LIMIT : TADS_LIMIT;
      if (used >= CYCLE_LIMIT || providerUsed >= providerLimit) {
        await tx.rollback();
        return fail(provider === 'adsgram' ? 'adsgram_cycle_limit_reached' : 'tads_cycle_limit_reached', 429);
      }

      const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [telegramId] });
      if (!wallet.rows.length) { await tx.rollback(); return fail('wallet_not_found', 404); }
      const oldCoins = Number(wallet.rows[0].coins_balance);
      const newCoins = oldCoins + REWARD_COINS;
      if (!Number.isSafeInteger(oldCoins) || oldCoins < 0 || !Number.isSafeInteger(newCoins)) { await tx.rollback(); return fail('invalid_wallet_balance', 409); }

      const nextUsed = used + 1;
      const nextAdsgram = adsgramUsed + (provider === 'adsgram' ? 1 : 0);
      const nextTads = tadsUsed + (provider === 'tads' ? 1 : 0);
      const completesCycle = nextUsed === CYCLE_LIMIT;
      const claimRowId = randomUUID();
      await tx.execute({
        sql: 'INSERT INTO ad_reward_claims(id, telegram_id, claim_id, widget_id, reward_coins) VALUES (?, ?, ?, ?, ?)',
        args: [claimRowId, telegramId, claimId, expectedWidgetId, REWARD_COINS],
      });
      await tx.execute({
        sql: `UPDATE ${CYCLE_TABLE} SET views=?, adsgram_views=?, tads_views=?,
          cooldown_until=CASE WHEN ?=1 THEN datetime('now', '+12 hours') ELSE NULL END,
          updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?`,
        args: [nextUsed, nextAdsgram, nextTads, completesCycle ? 1 : 0, telegramId],
      });
      await tx.execute({
        sql: 'UPDATE player_wallets SET coins_balance=?, lifetime_coins_earned=lifetime_coins_earned+?, updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
        args: [newCoins, REWARD_COINS, telegramId],
      });
      const metadata = JSON.stringify({ provider, widgetId: expectedWidgetId, claimId, reward: REWARD_COINS, cycleView: nextUsed, adsgramViews: nextAdsgram, tadsViews: nextTads, cycleLimit: CYCLE_LIMIT, cycleHours: CYCLE_HOURS });
      await tx.execute({
        sql: `INSERT INTO ledger_entries(id, telegram_id, asset, entry_type, amount, balance_after, reference_type, reference_id, idempotency_key, metadata_json)
          VALUES (?, ?, 'coins', 'ad_reward', ?, ?, 'ad_reward', ?, ?, ?)`,
        args: [randomUUID(), telegramId, REWARD_COINS, newCoins, claimRowId, `ad_reward:${telegramId}:${claimId}`, metadata],
      });
      await tx.execute({
        sql: `INSERT INTO player_events(id, telegram_id, event_type, amount, metadata_json, idempotency_key)
          VALUES (?, ?, 'ad_reward', ?, ?, ?)`,
        args: [randomUUID(), telegramId, REWARD_COINS, metadata, `event:ad_reward:${telegramId}:${claimId}`],
      });

      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      const weekDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const weekday = weekDate.getUTCDay() || 7;
      weekDate.setUTCDate(weekDate.getUTCDate() + 4 - weekday);
      const yearStart = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 1));
      const week = `${weekDate.getUTCFullYear()}-W${String(Math.ceil(((weekDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)).padStart(2, '0')}`;
      await tx.execute({ sql: `INSERT INTO player_daily_stats(telegram_id, day_key, coins_earned) VALUES (?, ?, ?) ON CONFLICT(telegram_id, day_key) DO UPDATE SET coins_earned=coins_earned+excluded.coins_earned, updated_at=CURRENT_TIMESTAMP`, args: [telegramId, day, REWARD_COINS] });
      await tx.execute({ sql: `INSERT INTO player_monthly_stats(telegram_id, month_key, coins_earned) VALUES (?, ?, ?) ON CONFLICT(telegram_id, month_key) DO UPDATE SET coins_earned=coins_earned+excluded.coins_earned, updated_at=CURRENT_TIMESTAMP`, args: [telegramId, month, REWARD_COINS] });
      await tx.execute({ sql: `INSERT INTO player_weekly_stats(telegram_id, week_key, coins_earned) VALUES (?, ?, ?) ON CONFLICT(telegram_id, week_key) DO UPDATE SET coins_earned=coins_earned+excluded.coins_earned, updated_at=CURRENT_TIMESTAMP`, args: [telegramId, week, REWARD_COINS] });
      const cooldown = completesCycle ? await tx.execute({ sql: "SELECT CAST(strftime('%s', datetime('now', '+12 hours')) AS INTEGER) * 1000 AS ms" }) : { rows: [{ ms: null }] };
      await tx.commit();
      return NextResponse.json({
        ok: true, duplicate: false, reward: REWARD_COINS, baseReward: REWARD_COINS,
        wallet: { coins: newCoins },
        cycle: cycleResponse(nextUsed, nextAdsgram, nextTads, cooldown.rows[0]?.ms == null ? null : Number(cooldown.rows[0].ms)),
      }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    console.error('ad_reward_claim_failed', error);
    return fail('ad_reward_unavailable', 503);
  }
}
