import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const INTERVAL_MS = 24 * 60 * 60 * 1000;

function responseError(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return responseError('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const id = String(user.id);
    await db.execute({ sql: "INSERT OR IGNORE INTO daily_login_rewards(telegram_id) VALUES(?)", args: [id] });
    const result = await db.execute({
      sql: 'SELECT streak_day,last_claimed_at FROM daily_login_rewards WHERE telegram_id=?',
      args: [id],
    });
    const row = result.rows[0];
    const lastClaimedAt = row?.last_claimed_at == null ? null : Number(row.last_claimed_at);
    const ready = lastClaimedAt === null || Date.now() >= lastClaimedAt + INTERVAL_MS;
    const day = ready ? (lastClaimedAt === null ? 1 : (Number(row?.streak_day ?? 0) % 7) + 1) : Number(row?.streak_day ?? 1);
    return NextResponse.json({
      day,
      reward: day,
      claimed: !ready,
      available: ready,
      nextClaimAt: lastClaimedAt === null ? null : lastClaimedAt + INTERVAL_MS,
      lastClaimedAt,
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('daily_login_status_failed', error);
    return responseError('daily_login_status_unavailable', 503);
  }
}

export async function POST(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return responseError('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const id = String(user.id);
    const tx = await db.transaction('write');
    try {
      const player = await tx.execute({ sql: "SELECT status FROM players WHERE telegram_id=? AND status='active'", args: [id] });
      if (!player.rows.length) { await tx.rollback(); return responseError('player_not_active', 403); }
      await tx.execute({ sql: "INSERT OR IGNORE INTO daily_login_rewards(telegram_id) VALUES(?)", args: [id] });
      const state = await tx.execute({
        sql: 'SELECT streak_day,last_claimed_at FROM daily_login_rewards WHERE telegram_id=?',
        args: [id],
      });
      const row = state.rows[0];
      const lastClaimedAt = row?.last_claimed_at == null ? null : Number(row.last_claimed_at);
      if (lastClaimedAt !== null && Date.now() < lastClaimedAt + INTERVAL_MS) {
        await tx.rollback();
        return responseError('daily_login_not_ready', 409);
      }
      const day = lastClaimedAt === null ? 1 : (Number(row?.streak_day ?? 0) % 7) + 1;
      const reward = day;
      const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [id] });
      if (!wallet.rows.length) { await tx.rollback(); return responseError('wallet_not_found', 404); }
      const balance = Number(wallet.rows[0].coins_balance) + reward;
      const claimAt = Date.now();
      const claimId = randomUUID();
      await tx.execute({
        sql: `INSERT INTO ledger_entries
          (id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json)
          VALUES(?,?,'coins','daily_login_reward',?,?,'daily_login',?,?,?)`,
        args: [randomUUID(), id, reward, balance, claimId, `daily-login:${id}:${claimAt}`, JSON.stringify({ day, reward, claimAt })],
      });
      await tx.execute({
        sql: 'UPDATE player_wallets SET coins_balance=coins_balance+?,lifetime_coins_earned=lifetime_coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
        args: [reward, reward, id],
      });
      await tx.execute({
        sql: 'UPDATE daily_login_rewards SET streak_day=?,last_claimed_at=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
        args: [day, claimAt, id],
      });
      await tx.execute({
        sql: "INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,'daily_login_reward',?,?,?)",
        args: [randomUUID(), id, reward, JSON.stringify({ day, reward, claimAt }), `daily-login-event:${id}:${claimAt}`],
      });
      await tx.commit();
      return NextResponse.json({
        ok: true, day, reward, walletCoins: balance,
        nextClaimAt: claimAt + INTERVAL_MS,
      }, { status: 201, headers: { 'Cache-Control': 'no-store, private' } });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    console.error('daily_login_claim_failed', error);
    const message = error instanceof Error ? error.message : '';
    if (message.includes('daily_coin_limit_reached')) return responseError('daily_coin_limit_reached', 409);
    return responseError('daily_login_claim_failed', 503);
  }
}
