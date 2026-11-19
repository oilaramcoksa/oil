import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMIT = 100;
const REWARD_MICROS = 1210;
const ZONE = '12295910';
const AD_BREAK_MS = 30_000;
const REWARD_BREAK_MS = 24 * 60 * 60 * 1000;

function cairoDayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return part('year') + '-' + part('month') + '-' + part('day');
}
function fail(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
}
function epoch(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
async function ensureColumn(db: ReturnType<typeof getTurso>, table: string, column: string, definition: string) {
  const result = await db.execute('PRAGMA table_info(' + table + ')');
  if (!result.rows.some((row) => String(row.name) === column)) {
    await db.execute('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition);
  }
}
async function ensureTables() {
  const db = getTurso();
  await db.execute("CREATE TABLE IF NOT EXISTS daily_monetag_ad_progress (telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE, day_key TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0 CHECK(views >= 0 AND views <= 100), paid_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(telegram_id,day_key))");
  await ensureColumn(db, 'daily_monetag_ad_progress', 'last_view_at', 'TEXT');
  await ensureColumn(db, 'daily_monetag_ad_progress', 'claimed_at', 'TEXT');
  await db.execute("CREATE TABLE IF NOT EXISTS daily_monetag_ad_claims (ymid TEXT PRIMARY KEY, telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE, day_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  await db.execute("CREATE TABLE IF NOT EXISTS usd_ledger_entries (id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE, entry_type TEXT NOT NULL, amount_micros INTEGER NOT NULL CHECK(amount_micros <> 0), balance_after_micros INTEGER NOT NULL CHECK(balance_after_micros >= 0), reference_type TEXT, reference_id TEXT, idempotency_key TEXT NOT NULL UNIQUE, metadata_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  await db.execute("CREATE TRIGGER IF NOT EXISTS usd_ledger_entries_no_update BEFORE UPDATE ON usd_ledger_entries BEGIN SELECT RAISE(ABORT, 'usd_ledger_entries_are_immutable'); END");
  await db.execute("CREATE TRIGGER IF NOT EXISTS usd_ledger_entries_no_delete BEFORE DELETE ON usd_ledger_entries BEGIN SELECT RAISE(ABORT, 'usd_ledger_entries_are_immutable'); END");
}
async function snapshot(telegramId: string) {
  const db = getTurso();
  const pending = await db.execute({
    sql: 'SELECT day_key,views,paid_at,claimed_at,last_view_at,updated_at FROM daily_monetag_ad_progress WHERE telegram_id=? AND views>=? AND paid_at IS NULL ORDER BY updated_at DESC LIMIT 1',
    args: [telegramId, LIMIT],
  });
  let row = pending.rows[0] ?? null;
  if (!row) {
    const claimed = await db.execute({
      sql: 'SELECT day_key,views,paid_at,claimed_at,last_view_at,updated_at FROM daily_monetag_ad_progress WHERE telegram_id=? AND paid_at IS NOT NULL ORDER BY COALESCE(claimed_at,paid_at) DESC LIMIT 1',
      args: [telegramId],
    });
    const candidate = claimed.rows[0] ?? null;
    const paidAt = epoch(candidate?.claimed_at ?? candidate?.paid_at);
    if (candidate && paidAt !== null && paidAt + REWARD_BREAK_MS > Date.now()) row = candidate;
  }
  if (!row) {
    const partial = await db.execute({
      sql: "SELECT day_key,views,paid_at,claimed_at,last_view_at,updated_at FROM daily_monetag_ad_progress WHERE telegram_id=? AND paid_at IS NULL AND views<? AND julianday(COALESCE(last_view_at,updated_at))>COALESCE((SELECT MAX(julianday(COALESCE(claimed_at,paid_at))) FROM daily_monetag_ad_progress WHERE telegram_id=? AND paid_at IS NOT NULL),0) ORDER BY updated_at DESC LIMIT 1",
      args: [telegramId, LIMIT, telegramId],
    });
    row = partial.rows[0] ?? null;
  }
  if (!row) {
    const dayKey = cairoDayKey();
    await db.execute({ sql: 'INSERT OR IGNORE INTO daily_monetag_ad_progress(telegram_id,day_key) VALUES(?,?)', args: [telegramId, dayKey] });
    const current = await db.execute({
      sql: 'SELECT day_key,views,paid_at,claimed_at,last_view_at,updated_at FROM daily_monetag_ad_progress WHERE telegram_id=? AND day_key=?',
      args: [telegramId, dayKey],
    });
    row = current.rows[0] ?? null;
  }
  const [wallet] = await Promise.all([
    db.execute({ sql: 'SELECT usd_micros FROM player_wallets WHERE telegram_id=?', args: [telegramId] }),
  ]);
  const views = Number(row?.views ?? 0);
  const usdMicros = Number(wallet.rows[0]?.usd_micros ?? 0);
  const claimedAt = epoch(row?.claimed_at ?? row?.paid_at);
  const lastViewAt = epoch(row?.last_view_at);
  const cooldownUntil = claimedAt === null ? null : claimedAt + REWARD_BREAK_MS;
  const adCooldownUntil = lastViewAt === null ? null : lastViewAt + AD_BREAK_MS;
  return {
    dayKey: String(row?.day_key ?? cairoDayKey()),
    views,
    limit: LIMIT,
    remaining: Math.max(0, LIMIT - views),
    completed: views >= LIMIT && Boolean(row?.paid_at),
    rewardReady: views >= LIMIT && !row?.paid_at,
    rewardClaimed: Boolean(row?.paid_at),
    rewardUsd: '0.00121',
    usdMicros,
    usdBalance: (usdMicros / 1_000_000).toFixed(6),
    cooldownUntil: cooldownUntil && cooldownUntil > Date.now() ? cooldownUntil : null,
    adCooldownUntil: adCooldownUntil && adCooldownUntil > Date.now() ? adCooldownUntil : null,
  };
}
export async function GET(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema();
    await ensureTables();
    return NextResponse.json(await snapshot(String(user.id)), { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('daily_monetag_progress_failed', error);
    return fail('daily_reward_unavailable', 503);
  }
}
export async function POST(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required', 401);
  let body: { ymid?: unknown; action?: unknown };
  try { body = await req.json(); } catch { return fail('invalid_body'); }
  const telegramId = String(user.id);
  try {
    await ensureDatabaseSchema();
    await ensureTables();
    const db = getTurso();

    if (body.action === 'claim') {
      const tx = await db.transaction('write');
      try {
        const pending = await tx.execute({
          sql: 'SELECT day_key,views,paid_at FROM daily_monetag_ad_progress WHERE telegram_id=? AND views>=? AND paid_at IS NULL ORDER BY updated_at DESC LIMIT 1',
          args: [telegramId, LIMIT],
        });
        const cycle = pending.rows[0];
        if (!cycle) {
          await tx.rollback();
          const current = await snapshot(telegramId);
          if (current.completed || current.cooldownUntil) {
            return NextResponse.json({ ok: true, alreadyClaimed: true, progress: current }, { headers: { 'Cache-Control': 'no-store' } });
          }
          return fail('daily_reward_not_ready', 409);
        }
        const player = await tx.execute({ sql: "SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'", args: [telegramId] });
        if (!player.rows.length) { await tx.rollback(); return fail('player_not_active', 403); }
        const wallet = await tx.execute({
          sql: 'UPDATE player_wallets SET usd_micros=usd_micros+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? RETURNING usd_micros',
          args: [REWARD_MICROS, telegramId],
        });
        if (!wallet.rows.length) throw new Error('player_wallet_not_found');
        const after = Number(wallet.rows[0].usd_micros);
        const dayKey = String(cycle.day_key);
        const key = 'daily_monetag_usd:' + telegramId + ':' + dayKey;
        await tx.execute({
          sql: "INSERT INTO usd_ledger_entries(id,telegram_id,entry_type,amount_micros,balance_after_micros,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'daily_ad_reward',?,?,'daily_ad_cycle',?,?,?)",
          args: [randomUUID(), telegramId, REWARD_MICROS, after, dayKey, key, JSON.stringify({ provider: 'monetag', zoneId: ZONE, verifiedImpressions: LIMIT, rewardUsd: '0.00121' })],
        });
        const claimedAt = new Date().toISOString();
        await tx.execute({
          sql: 'UPDATE daily_monetag_ad_progress SET paid_at=?,claimed_at=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND day_key=? AND paid_at IS NULL',
          args: [claimedAt, claimedAt, telegramId, dayKey],
        });
        await tx.commit();
        return NextResponse.json({ ok: true, credited: true, rewardUsd: '0.00121', progress: await snapshot(telegramId) }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    }

    const ymid = typeof body.ymid === 'string' ? body.ymid : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ymid)) return fail('invalid_ymid');
    const tx = await db.transaction('write');
    try {
      const prior = await tx.execute({ sql: 'SELECT day_key FROM daily_monetag_ad_claims WHERE ymid=? AND telegram_id=?', args: [ymid, telegramId] });
      if (prior.rows.length) {
        await tx.commit();
        return NextResponse.json({ ok: true, duplicate: true, progress: await snapshot(telegramId) }, { headers: { 'Cache-Control': 'no-store' } });
      }
      const verified = await tx.execute({
        sql: "SELECT ymid FROM monetag_ad_postbacks WHERE ymid=? AND telegram_id=? AND zone_id=? AND event_type='impression' AND reward_event_type='valued' AND consumed_at IS NULL LIMIT 1",
        args: [ymid, telegramId, ZONE],
      });
      if (!verified.rows.length) { await tx.rollback(); return fail('monetag_postback_not_verified', 409); }
      const player = await tx.execute({ sql: "SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'", args: [telegramId] });
      if (!player.rows.length) { await tx.rollback(); return fail('player_not_active', 403); }
      const lastReward = await tx.execute({
        sql: 'SELECT COALESCE(claimed_at,paid_at) AS claimed_at FROM daily_monetag_ad_progress WHERE telegram_id=? AND paid_at IS NOT NULL ORDER BY COALESCE(claimed_at,paid_at) DESC LIMIT 1',
        args: [telegramId],
      });
      const lastRewardAt = epoch(lastReward.rows[0]?.claimed_at);
      const rewardCooldownUntil = lastRewardAt === null ? null : lastRewardAt + REWARD_BREAK_MS;
      if (rewardCooldownUntil && rewardCooldownUntil > Date.now()) {
        await tx.rollback();
        return fail('daily_reward_cooldown_active', 429, { cooldownUntil: rewardCooldownUntil });
      }

      const pending = await tx.execute({
        sql: 'SELECT day_key FROM daily_monetag_ad_progress WHERE telegram_id=? AND views>=? AND paid_at IS NULL ORDER BY updated_at DESC LIMIT 1',
        args: [telegramId, LIMIT],
      });
      if (pending.rows.length) { await tx.rollback(); return fail('daily_ad_limit_reached', 429); }
      const partial = await tx.execute({
        sql: "SELECT day_key,views,last_view_at FROM daily_monetag_ad_progress WHERE telegram_id=? AND paid_at IS NULL AND views<? AND julianday(COALESCE(last_view_at,updated_at))>COALESCE((SELECT MAX(julianday(COALESCE(claimed_at,paid_at))) FROM daily_monetag_ad_progress WHERE telegram_id=? AND paid_at IS NOT NULL),0) ORDER BY updated_at DESC LIMIT 1",
        args: [telegramId, LIMIT, telegramId],
      });
      let cycle = partial.rows[0] ?? null;
      if (!cycle) {
        const dayKey = cairoDayKey();
        await tx.execute({ sql: 'INSERT OR IGNORE INTO daily_monetag_ad_progress(telegram_id,day_key) VALUES(?,?)', args: [telegramId, dayKey] });
        const current = await tx.execute({
          sql: 'SELECT day_key,views,last_view_at FROM daily_monetag_ad_progress WHERE telegram_id=? AND day_key=?',
          args: [telegramId, dayKey],
        });
        cycle = current.rows[0] ?? null;
      }
      const lastViewAt = epoch(cycle?.last_view_at);
      const retryAt = lastViewAt === null ? null : lastViewAt + AD_BREAK_MS;
      if (retryAt && retryAt > Date.now()) {
        await tx.rollback();
        return fail('ad_cooldown_active', 429, { cooldownUntil: retryAt });
      }
      const dayKey = String(cycle?.day_key ?? cairoDayKey());
      const count = Number(cycle?.views ?? 0);
      if (count >= LIMIT) { await tx.rollback(); return fail('daily_ad_limit_reached', 429); }
      await tx.execute({ sql: 'INSERT INTO daily_monetag_ad_claims(ymid,telegram_id,day_key) VALUES(?,?,?)', args: [ymid, telegramId, dayKey] });
      await tx.execute({ sql: 'UPDATE monetag_ad_postbacks SET consumed_at=CURRENT_TIMESTAMP WHERE ymid=? AND consumed_at IS NULL', args: [ymid] });
      const next = count + 1;
      const viewedAt = new Date().toISOString();
      await tx.execute({
        sql: 'UPDATE daily_monetag_ad_progress SET views=?,last_view_at=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND day_key=?',
        args: [next, viewedAt, telegramId, dayKey],
      });
      await tx.commit();
      return NextResponse.json({ ok: true, credited: false, progress: await snapshot(telegramId) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    console.error('daily_monetag_reward_claim_failed', error);
    return fail('daily_reward_unavailable', 503);
  }
}
