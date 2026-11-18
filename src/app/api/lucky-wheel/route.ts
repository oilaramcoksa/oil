import { randomInt, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIZES = [10, 5, 15, 25, 35, 45, 7, 20];
const ADEXIUM_WIDGET_ID = 'fac3402b-57c4-45be-9d1d-5589a334852d';
const TADS_REWARDED_WIDGET_ID = '13283';
const AD_TARGET = 3;
const FREE_SPIN_MS = 24 * 60 * 60 * 1000;

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function ensureLuckyWheelTables() {
  const db = getTurso();
  await db.execute(`CREATE TABLE IF NOT EXISTS player_lucky_wheel (
    telegram_id TEXT PRIMARY KEY REFERENCES players(telegram_id) ON DELETE CASCADE,
    last_free_spin_at INTEGER,
    ad_views INTEGER NOT NULL DEFAULT 0 CHECK(ad_views >= 0 AND ad_views <= 3),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS tads_ad_webhook_events (
    id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL,
    widget_id TEXT NOT NULL CHECK(widget_id IN ('13283','13284')),
    event_type TEXT NOT NULL CHECK(event_type IN ('view','click')),
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, consumed_at TEXT
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_tads_ad_events_claim ON tads_ad_webhook_events(telegram_id,widget_id,consumed_at,received_at)');
  await db.execute(`CREATE TABLE IF NOT EXISTS lucky_wheel_ad_claims (
    id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
    claim_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('tads','adexium')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(telegram_id,claim_id)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS lucky_wheel_spins (
    id TEXT PRIMARY KEY,
    telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
    prize INTEGER NOT NULL,
    prize_index INTEGER NOT NULL,
    spin_type TEXT NOT NULL CHECK(spin_type IN ('free','ads')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    request_id TEXT
  )`);
  const spinColumns = await db.execute('PRAGMA table_info(lucky_wheel_spins)');
  if (!spinColumns.rows.some((row) => row.name === 'request_id')) await db.execute('ALTER TABLE lucky_wheel_spins ADD COLUMN request_id TEXT');
  await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_lucky_wheel_spin_request ON lucky_wheel_spins(telegram_id,request_id)');
}

function stateOf(row: Record<string, unknown> | undefined, now = Date.now()) {
  const lastFree = row?.last_free_spin_at == null ? null : Number(row.last_free_spin_at);
  const freeAvailable = lastFree === null || now - lastFree >= FREE_SPIN_MS;
  const adViews = Math.max(0, Math.min(3, Number(row?.ad_views ?? 0)));
  return {
    freeAvailable,
    freeNextAt: lastFree === null ? null : lastFree + FREE_SPIN_MS,
    adViews,
    adsNeeded: Math.max(0, AD_TARGET - adViews),
    extraSpinAvailable: adViews >= AD_TARGET,
    prizes: PRIZES,
  };
}

export async function GET(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema();
    await ensureLuckyWheelTables();
    const db = getTurso();
    await db.execute({ sql: 'INSERT OR IGNORE INTO player_lucky_wheel(telegram_id) VALUES(?)', args: [String(user.id)] });
    const result = await db.execute({ sql: 'SELECT last_free_spin_at, ad_views FROM player_lucky_wheel WHERE telegram_id=?', args: [String(user.id)] });
    return NextResponse.json(stateOf(result.rows[0] as Record<string, unknown> | undefined), { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('lucky_wheel_state_failed', error);
    return fail('lucky_wheel_unavailable', 503);
  }
}

export async function POST(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required', 401);
  let body: { action?: unknown; provider?: unknown; widgetId?: unknown; taskId?: unknown; claimId?: unknown; requestId?: unknown };
  try { body = await req.json(); } catch { return fail('invalid_body'); }

  try {
    await ensureDatabaseSchema();
    await ensureLuckyWheelTables();
    const db = getTurso();
    const telegramId = String(user.id);
    const player = await db.execute({ sql: "SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'", args: [telegramId] });
    if (!player.rows.length) return fail('player_not_active', 403);

    if (body.action === 'ad') {
      const provider = body.provider === 'adexium' ? 'adexium' : body.provider === 'tads' ? 'tads' : null;
      if (!provider) return fail('invalid_ad_provider');
      const claimId = provider === 'adexium'
        ? (typeof body.taskId === 'string' ? body.taskId : '')
        : (typeof body.claimId === 'string' ? body.claimId : '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claimId)) return fail('invalid_ad_task');
      if (String(body.widgetId) !== (provider === 'adexium' ? ADEXIUM_WIDGET_ID : TADS_REWARDED_WIDGET_ID)) return fail('invalid_ad_widget');
      if (provider === 'adexium') {
        const check = await fetch(`https://bid.tgads.live/task/check/${encodeURIComponent(ADEXIUM_WIDGET_ID)}/${encodeURIComponent(claimId)}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!check.ok) return fail('ad_verification_unavailable', 503);
        const verification = await check.json() as { done?: boolean };
        if (verification.done !== true) return fail('ad_not_completed', 409);
      }
      const tx = await db.transaction('write');
      try {
        const duplicate = await tx.execute({ sql: 'SELECT id FROM lucky_wheel_ad_claims WHERE telegram_id=? AND claim_id=?', args: [telegramId, claimId] });
        if (duplicate.rows.length) {
          const current = await tx.execute({ sql: 'SELECT ad_views FROM player_lucky_wheel WHERE telegram_id=?', args: [telegramId] });
          await tx.commit();
          const views = Number(current.rows[0]?.ad_views ?? 0);
          return NextResponse.json({ ok: true, duplicate: true, adViews: views, adsNeeded: Math.max(0, AD_TARGET - views) }, { headers: { 'Cache-Control': 'no-store' } });
        }
        if (provider === 'tads') {
          const verifiedView = await tx.execute({
            sql: "SELECT id FROM tads_ad_webhook_events WHERE telegram_id=? AND widget_id='13283' AND event_type='view' AND consumed_at IS NULL AND received_at >= datetime('now','-10 minutes') ORDER BY received_at ASC LIMIT 1",
            args: [telegramId],
          });
          if (!verifiedView.rows.length) { await tx.rollback(); return fail('tads_view_not_verified', 409); }
          const consumed = await tx.execute({
            sql: 'UPDATE tads_ad_webhook_events SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND consumed_at IS NULL RETURNING id',
            args: [String(verifiedView.rows[0].id)],
          });
          if (!consumed.rows.length) { await tx.rollback(); return fail('tads_view_not_verified', 409); }
        }
        await tx.execute({ sql: 'INSERT INTO lucky_wheel_ad_claims(id,telegram_id,claim_id,provider) VALUES(?,?,?,?)', args: [randomUUID(), telegramId, claimId, provider] });
        await tx.execute({ sql: 'INSERT OR IGNORE INTO player_lucky_wheel(telegram_id) VALUES(?)', args: [telegramId] });
        const current = await tx.execute({ sql: 'SELECT ad_views FROM player_lucky_wheel WHERE telegram_id=?', args: [telegramId] });
        const views = Number(current.rows[0]?.ad_views ?? 0);
        if (views >= AD_TARGET) { await tx.rollback(); return fail('three_ads_already_completed', 409); }
        const next = views + 1;
        await tx.execute({ sql: 'UPDATE player_lucky_wheel SET ad_views=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?', args: [next, telegramId] });
        await tx.execute({
          sql: 'INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,\'lucky_wheel_ad\',0,?,?)',
          args: [randomUUID(), telegramId, JSON.stringify({ provider, widgetId: String(body.widgetId), completedViews: next }), `lucky_wheel_ad:${telegramId}:${provider}:${claimId}`],
        });
        await tx.commit();
        return NextResponse.json({ ok: true, adViews: next, adsNeeded: Math.max(0, AD_TARGET - next) }, { headers: { 'Cache-Control': 'no-store' } });
      } catch (error) { await tx.rollback(); throw error; }
    }

    if (body.action !== 'spin') return fail('invalid_action');
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return fail('invalid_spin_request');
    const tx = await db.transaction('write');
    try {
      await tx.execute({ sql: 'INSERT OR IGNORE INTO player_lucky_wheel(telegram_id) VALUES(?)', args: [telegramId] });
      const current = await tx.execute({ sql: 'SELECT last_free_spin_at,ad_views FROM player_lucky_wheel WHERE telegram_id=?', args: [telegramId] });
      const row = current.rows[0] as Record<string, unknown>;
      const previousSpin = await tx.execute({
        sql: 'SELECT id,prize,prize_index,spin_type FROM lucky_wheel_spins WHERE telegram_id=? AND request_id=?',
        args: [telegramId, requestId],
      });
      if (previousSpin.rows.length) {
        const previous = previousSpin.rows[0];
        const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [telegramId] });
        await tx.commit();
        return NextResponse.json({
          ok: true, duplicate: true, prize: Number(previous.prize), prizeIndex: Number(previous.prize_index),
          spinType: String(previous.spin_type), balance: Number(wallet.rows[0]?.coins_balance ?? 0),
          spinId: String(previous.id), state: stateOf(row),
        }, { headers: { 'Cache-Control': 'no-store' } });
      }
      const now = Date.now();
      const lastFree = row.last_free_spin_at == null ? null : Number(row.last_free_spin_at);
      const freeAvailable = lastFree === null || now - lastFree >= FREE_SPIN_MS;
      const adViews = Number(row.ad_views ?? 0);
      let spinType: 'free' | 'ads';
      if (freeAvailable) {
        spinType = 'free';
        await tx.execute({ sql: 'UPDATE player_lucky_wheel SET last_free_spin_at=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?', args: [now, telegramId] });
      } else if (adViews >= AD_TARGET) {
        spinType = 'ads';
        await tx.execute({ sql: 'UPDATE player_lucky_wheel SET ad_views=0,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?', args: [telegramId] });
      } else {
        await tx.rollback();
        return fail('spin_not_ready', 409);
      }

      const prizeIndex = randomInt(0, PRIZES.length);
      const prize = PRIZES[prizeIndex];
      const spinId = randomUUID();
      const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [telegramId] });
      if (!wallet.rows.length) { await tx.rollback(); return fail('wallet_not_found', 404); }
      const oldBalance = Number(wallet.rows[0].coins_balance);
      const newBalance = oldBalance + prize;
      if (!Number.isSafeInteger(oldBalance) || oldBalance < 0 || !Number.isSafeInteger(newBalance)) { await tx.rollback(); return fail('wallet_balance_invalid', 409); }
      // Insert the auditable reward first. The daily-cap trigger recognizes
      // this exact ledger entry and exempts lucky-wheel prizes from the cap.
      await tx.execute({
        sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','lucky_wheel',?,?,'lucky_wheel',?,?,?)",
        args: [randomUUID(), telegramId, prize, newBalance, spinId, `lucky_wheel:${spinId}`, JSON.stringify({ spinType, prizeIndex, dailyCapExempt: true })],
      });
      await tx.execute({ sql: 'UPDATE player_wallets SET coins_balance=?,lifetime_coins_earned=lifetime_coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?', args: [newBalance, prize, telegramId] });
      await tx.execute({ sql: 'INSERT INTO lucky_wheel_spins(id,telegram_id,prize,prize_index,spin_type,request_id) VALUES(?,?,?,?,?,?)', args: [spinId, telegramId, prize, prizeIndex, spinType, requestId] });
      await tx.execute({
        sql: 'INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,\'lucky_wheel_win\',?,?,?)',
        args: [randomUUID(), telegramId, prize, JSON.stringify({ spinType, prizeIndex, spinId }), `lucky_wheel_win:${spinId}`],
      });
      await tx.commit();
      return NextResponse.json({ ok: true, prize, prizeIndex, spinType, balance: newBalance, spinId, state: { freeAvailable: spinType === 'free' ? false : freeAvailable, freeNextAt: spinType === 'free' ? now + FREE_SPIN_MS : lastFree === null ? null : lastFree + FREE_SPIN_MS, adViews: spinType === 'ads' ? 0 : adViews, adsNeeded: spinType === 'ads' ? 3 : Math.max(0, 3 - adViews), extraSpinAvailable: false } }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { await tx.rollback(); throw error; }
  } catch (error) {
    if (error instanceof Error && error.message.includes('daily_coin_limit_reached')) return fail('daily_coin_limit_reached', 429);
    console.error('lucky_wheel_action_failed', error);
    return fail('lucky_wheel_unavailable', 503);
  }
}
