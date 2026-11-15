import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';
import {
  isTelegramMember,
  checkAndRevokeMembership,
  TELEGRAM_MEMBERSHIP_TASKS,
  type TelegramMembershipTask,
} from '@/lib/telegram-membership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validTask(value: unknown): value is TelegramMembershipTask {
  return value === 'channel' || value === 'group';
}

export async function GET(req: NextRequest) {
  const player = verifiedPlayerFromRequest(req);
  if (!player) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'telegram_bot_not_configured' }, { status: 503 });

  try {
    await ensureDatabaseSchema();
    const telegramId = String(player.id);
    const result: Record<string, { claimed: boolean; joined: boolean; revoked: boolean }> = {};
    for (const taskId of ['channel', 'group'] as const) {
      const config = TELEGRAM_MEMBERSHIP_TASKS[taskId];
      const rowResult = await getTurso().execute({
        sql: 'SELECT active FROM task_claims WHERE telegram_id=? AND task_id=? AND period_key=?',
        args: [telegramId, config.dbId, 'once'],
      });
      const exists = rowResult.rows.length > 0;
      let claimed = exists && Number(rowResult.rows[0].active ?? 1) === 1;
      let joined = false;
      let revoked = false;

      if (claimed) {
        const check = await checkAndRevokeMembership(telegramId, taskId);
        claimed = check.active;
        revoked = check.revoked;
        if (!claimed) joined = await isTelegramMember(token, config.chat, telegramId);
      } else {
        joined = await isTelegramMember(token, config.chat, telegramId);
      }
      result[taskId] = { claimed, joined, revoked };
    }
    return NextResponse.json({
      claimed: { channel: result.channel.claimed, group: result.group.claimed },
      joined: { channel: result.channel.joined, group: result.group.joined },
      revoked: { channel: result.channel.revoked, group: result.group.revoked },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('telegram_task_status_failed', error);
    return NextResponse.json({ error: 'task_status_unavailable' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const player = verifiedPlayerFromRequest(req);
  if (!player) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });
  let body: { taskId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
  if (!validTask(body.taskId)) return NextResponse.json({ error: 'invalid_task' }, { status: 400 });

  const taskId = body.taskId;
  const config = TELEGRAM_MEMBERSHIP_TASKS[taskId];
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'telegram_bot_not_configured' }, { status: 503 });

  try {
    const telegramId = String(player.id);
    const joined = await isTelegramMember(token, config.chat, telegramId);
    if (!joined) return NextResponse.json({ error: 'telegram_membership_required' }, { status: 403 });

    await ensureDatabaseSchema();
    const db = getTurso();
    const tx = await db.transaction('write');
    try {
      const existing = await tx.execute({
        sql: 'SELECT id,active FROM task_claims WHERE telegram_id=? AND task_id=? AND period_key=?',
        args: [telegramId, config.dbId, 'once'],
      });
      if (existing.rows.length) {
        const wasActive = Number(existing.rows[0].active ?? 1) === 1;
        if (!wasActive) {
          await tx.execute({
            sql: 'UPDATE task_claims SET active=1,last_checked_at=CURRENT_TIMESTAMP,revoked_at=NULL WHERE telegram_id=? AND task_id=? AND period_key=?',
            args: [telegramId, config.dbId, 'once'],
          });
        } else {
          await tx.execute({
            sql: 'UPDATE task_claims SET last_checked_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND task_id=? AND period_key=?',
            args: [telegramId, config.dbId, 'once'],
          });
        }
        const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [telegramId] });
        await tx.commit();
        return NextResponse.json({
          ok: true,
          alreadyClaimed: true,
          reactivated: !wasActive,
          reward: config.reward,
          walletCoins: Number(wallet.rows[0]?.coins_balance ?? 0),
        });
      }

      const account = await tx.execute({
        sql: "SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'",
        args: [telegramId],
      });
      if (!account.rows.length) {
        await tx.rollback();
        return NextResponse.json({ error: 'player_not_active' }, { status: 403 });
      }
      await tx.execute({
        sql: 'INSERT INTO task_claims(id,telegram_id,task_id,period_key,reward_coins,active,last_checked_at) VALUES(?,?,?,?,?,1,CURRENT_TIMESTAMP)',
        args: [randomUUID(), telegramId, config.dbId, 'once', config.reward],
      });
      await tx.execute({ sql: 'INSERT OR IGNORE INTO player_wallets(telegram_id) VALUES(?)', args: [telegramId] });
      await tx.execute({
        sql: 'UPDATE player_wallets SET coins_balance=coins_balance+?,lifetime_coins_earned=lifetime_coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
        args: [config.reward, config.reward, telegramId],
      });
      const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [telegramId] });
      const balance = Number(wallet.rows[0]?.coins_balance ?? 0);
      await tx.execute({
        sql: `INSERT INTO ledger_entries
          (id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json)
          VALUES(?,?,'coins','task_reward',?,?,'task',?,?,?)`,
        args: [randomUUID(), telegramId, config.reward, balance, config.dbId,
          `task-reward:${config.dbId}:${telegramId}`,
          JSON.stringify({ taskId, source: 'telegram_membership' })],
      });
      await tx.commit();
      return NextResponse.json({ ok: true, reward: config.reward, walletCoins: balance });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    console.error('telegram_task_claim_failed', error);
    return NextResponse.json({ error: 'task_claim_failed' }, { status: 503 });
  }
}
