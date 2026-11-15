import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TASKS = {
  channel: { chat: '@qrmcooil', reward: 2000 },
  group: { chat: '@armcooil', reward: 2000 },
} as const;

type TaskId = keyof typeof TASKS;

function periodKey() { return 'once'; }

export async function GET(req: NextRequest) {
  const player = verifiedPlayerFromRequest(req);
  if (!player) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const rows = await db.execute({
      sql: "SELECT task_id FROM task_claims WHERE telegram_id=? AND task_id IN ('telegram_channel','telegram_group') AND period_key=?",
      args: [String(player.id), periodKey()],
    });
    return NextResponse.json({
      claimed: {
        channel: rows.rows.some((r) => String(r.task_id) === 'telegram_channel'),
        group: rows.rows.some((r) => String(r.task_id) === 'telegram_group'),
      },
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
  const taskId = body.taskId;
  if (taskId !== 'channel' && taskId !== 'group') return NextResponse.json({ error: 'invalid_task' }, { status: 400 });
  const config = TASKS[taskId];
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ error: 'telegram_bot_not_configured' }, { status: 503 });

  try {
    const memberResponse = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chat, user_id: Number(player.id) }),
      cache: 'no-store',
    });
    const memberData = await memberResponse.json() as {
      ok?: boolean;
      result?: { status?: string; is_member?: boolean };
    };
    const member = memberData.result;
    const joined = memberData.ok && !!member && (
      member.status === 'creator' || member.status === 'administrator' ||
      member.status === 'member' || (member.status === 'restricted' && member.is_member === true)
    );
    if (!joined) return NextResponse.json({ error: 'telegram_membership_required' }, { status: 403 });

    await ensureDatabaseSchema();
    const db = getTurso();
    const telegramId = String(player.id);
    const dbTaskId = taskId === 'channel' ? 'telegram_channel' : 'telegram_group';
    const tx = await db.transaction('write');
    try {
      const existing = await tx.execute({
        sql: 'SELECT id FROM task_claims WHERE telegram_id=? AND task_id=? AND period_key=?',
        args: [telegramId, dbTaskId, periodKey()],
      });
      if (existing.rows.length) {
        await tx.commit();
        return NextResponse.json({ ok: true, alreadyClaimed: true, reward: config.reward });
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
        sql: 'INSERT INTO task_claims(id,telegram_id,task_id,period_key,reward_coins) VALUES(?,?,?,?,?)',
        args: [randomUUID(), telegramId, dbTaskId, periodKey(), config.reward],
      });
      await tx.execute({
        sql: 'INSERT OR IGNORE INTO player_wallets(telegram_id) VALUES(?)',
        args: [telegramId],
      });
      await tx.execute({
        sql: 'UPDATE player_wallets SET coins_balance=coins_balance+?,lifetime_coins_earned=lifetime_coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
        args: [config.reward, config.reward, telegramId],
      });
      const wallet = await tx.execute({
        sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',
        args: [telegramId],
      });
      const balance = Number(wallet.rows[0]?.coins_balance ?? 0);
      await tx.execute({
        sql: `INSERT INTO ledger_entries
          (id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json)
          VALUES(?,?,'coins','task_reward',?,?,'task',?,?,?)`,
        args: [randomUUID(), telegramId, config.reward, balance, dbTaskId,
          `task-reward:${dbTaskId}:${telegramId}`,
          JSON.stringify({ taskId: dbTaskId, source: 'telegram_membership' })],
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
