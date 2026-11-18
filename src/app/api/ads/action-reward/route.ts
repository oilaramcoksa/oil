import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REWARD_COINS = 20;
const ALLOWED_PURPOSES = new Set(['sell_action', 'mining_start', 'automatic_in_app']);

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required', 401);

  let body: { ymid?: unknown; purpose?: unknown };
  try { body = await req.json(); } catch { return fail('invalid_body'); }
  const ymid = typeof body.ymid === 'string' ? body.ymid : '';
  const purpose = typeof body.purpose === 'string' ? body.purpose : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ymid)) return fail('invalid_ymid');
  if (!ALLOWED_PURPOSES.has(purpose)) return fail('invalid_ad_purpose');

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    await db.execute(`CREATE TABLE IF NOT EXISTS monetag_ad_postbacks (
      ymid TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, zone_id TEXT NOT NULL,
      event_type TEXT NOT NULL, reward_event_type TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, consumed_at TEXT
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS monetag_action_ad_claims (
      id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      ymid TEXT NOT NULL UNIQUE, purpose TEXT NOT NULL, reward_coins INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const telegramId = String(user.id);
    const tx = await db.transaction('write');
    try {
      const already = await tx.execute({
        sql: 'SELECT reward_coins FROM monetag_action_ad_claims WHERE telegram_id=? AND ymid=?',
        args: [telegramId, ymid],
      });
      if (already.rows.length) {
        const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [telegramId] });
        await tx.commit();
        return NextResponse.json({ ok: true, duplicate: true, reward: Number(already.rows[0].reward_coins), wallet: { coins: Number(wallet.rows[0]?.coins_balance ?? 0) } }, { headers: { 'Cache-Control': 'no-store' } });
      }

      const verified = await tx.execute({
        sql: "SELECT ymid FROM monetag_ad_postbacks WHERE ymid=? AND telegram_id=? AND zone_id='12295910' AND event_type='impression' AND reward_event_type='valued' AND consumed_at IS NULL LIMIT 1",
        args: [ymid, telegramId],
      });
      if (!verified.rows.length) { await tx.rollback(); return fail('monetag_postback_not_verified', 409); }

      const player = await tx.execute({ sql: "SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'", args: [telegramId] });
      if (!player.rows.length) { await tx.rollback(); return fail('player_not_active', 403); }
      const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [telegramId] });
      if (!wallet.rows.length) { await tx.rollback(); return fail('wallet_not_found', 404); }
      const oldBalance = Number(wallet.rows[0].coins_balance);
      const newBalance = oldBalance + REWARD_COINS;
      if (!Number.isSafeInteger(oldBalance) || oldBalance < 0 || !Number.isSafeInteger(newBalance)) { await tx.rollback(); return fail('wallet_balance_invalid', 409); }

      const claimId = randomUUID();
      await tx.execute({ sql: 'UPDATE monetag_ad_postbacks SET consumed_at=CURRENT_TIMESTAMP WHERE ymid=? AND consumed_at IS NULL', args: [ymid] });
      await tx.execute({ sql: 'INSERT INTO monetag_action_ad_claims(id,telegram_id,ymid,purpose,reward_coins) VALUES(?,?,?,?,?)', args: [claimId, telegramId, ymid, purpose, REWARD_COINS] });
      await tx.execute({ sql: 'UPDATE player_wallets SET coins_balance=?,lifetime_coins_earned=lifetime_coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?', args: [newBalance, REWARD_COINS, telegramId] });
      const metadata = JSON.stringify({ provider: 'monetag', zoneId: 12295910, purpose, ymid, reward: REWARD_COINS });
      await tx.execute({
        sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','ad_reward',?,?,'monetag_ad',?,?,?)",
        args: [randomUUID(), telegramId, REWARD_COINS, newBalance, claimId, `monetag_action_ad:${ymid}`, metadata],
      });
      await tx.execute({
        sql: "INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,'monetag_action_ad_reward',?,?,?)",
        args: [randomUUID(), telegramId, REWARD_COINS, metadata, `event:monetag_action_ad:${ymid}`],
      });
      await tx.commit();
      return NextResponse.json({ ok: true, duplicate: false, reward: REWARD_COINS, wallet: { coins: newBalance } }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('daily_coin_limit_reached')) return fail('daily_reward_limit_reached', 429);
    console.error('monetag_action_reward_failed', error);
    return fail('monetag_action_reward_unavailable', 503);
  }
}
