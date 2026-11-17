import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function currentWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

export async function POST(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });
  await ensureDatabaseSchema();
  const db = getTurso();
  const id = String(user.id);
  const weekKey = currentWeekKey();
  const tx = await db.transaction('write');
  try {
    const player = await tx.execute({ sql: "SELECT status FROM players WHERE telegram_id=? AND status='active'", args: [id] });
    if (!player.rows.length) {
      await tx.rollback();
      return NextResponse.json({ error: 'player_not_active' }, { status: 403 });
    }
    const existing = await tx.execute({ sql: 'SELECT week_key FROM lucky_box_claims WHERE telegram_id=?', args: [id] });
    if (existing.rows[0]?.week_key === weekKey) {
      await tx.rollback();
      return NextResponse.json({ error: 'lucky_box_already_claimed' }, { status: 409 });
    }
    const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [id] });
    if (!wallet.rows.length) {
      await tx.rollback();
      return NextResponse.json({ error: 'wallet_not_found' }, { status: 404 });
    }
    const reward = randomUUID().split('-').join('').slice(0, 8);
    const rewardCoins = 10 + (parseInt(reward, 16) % 41);
    const balance = Number(wallet.rows[0].coins_balance) + rewardCoins;
    const claimedAt = Date.now();
    await tx.execute({
      sql: `INSERT INTO lucky_box_claims(telegram_id,week_key,reward_coins,claimed_at)
        VALUES(?,?,?,?)
        ON CONFLICT(telegram_id) DO UPDATE SET week_key=excluded.week_key,reward_coins=excluded.reward_coins,claimed_at=excluded.claimed_at`,
      args: [id, weekKey, rewardCoins, claimedAt],
    });
    await tx.execute({
      sql: `INSERT INTO ledger_entries
        (id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json)
        VALUES(?,?,'coins','lucky_box_reward',?,?,'lucky_box',?,?,?)`,
      args: [randomUUID(), id, rewardCoins, balance, weekKey, `lucky-box:${id}:${weekKey}`, JSON.stringify({ weekKey, reward: rewardCoins, claimedAt })],
    });
    await tx.execute({
      sql: 'UPDATE player_wallets SET coins_balance=coins_balance+?,lifetime_coins_earned=lifetime_coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
      args: [rewardCoins, rewardCoins, id],
    });
    await tx.execute({
      sql: "INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,'lucky_box_reward',?,?,?)",
      args: [randomUUID(), id, rewardCoins, JSON.stringify({ weekKey, reward: rewardCoins, claimedAt }), `lucky-box-event:${id}:${weekKey}`],
    });
    await tx.commit();
    return NextResponse.json({ ok: true, reward: rewardCoins, walletCoins: balance, weekKey }, { status: 201, headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    await tx.rollback();
    console.error('lucky_box_claim_failed', error);
    return NextResponse.json({ error: 'lucky_box_claim_failed' }, { status: 503 });
  }
}
