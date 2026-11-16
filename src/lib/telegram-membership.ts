import { randomUUID } from 'node:crypto';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';

export const TELEGRAM_MEMBERSHIP_TASKS = {
  channel: { chat: '@qrmcooil', dbId: 'telegram_channel', reward: 150 },
  group: { chat: '@armcooil', dbId: 'telegram_group', reward: 150 },
} as const;

export type TelegramMembershipTask = keyof typeof TELEGRAM_MEMBERSHIP_TASKS;
const CHECK_INTERVAL_MS = 10 * 60 * 60 * 1000;

export async function isTelegramMember(botToken: string, chatId: string, telegramId: string): Promise<boolean> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, user_id: Number(telegramId) }),
    cache: 'no-store',
  });
  const data = await response.json() as {
    ok?: boolean;
    description?: string;
    result?: { status?: string; is_member?: boolean };
  };
  if (!response.ok || !data.ok) throw new Error(data.description || 'telegram_get_chat_member_failed');
  const member = data.result;
  return !!member && (
    member.status === 'creator' || member.status === 'administrator' ||
    member.status === 'member' || (member.status === 'restricted' && member.is_member === true)
  );
}

export async function checkAndRevokeMembership(
  telegramId: string,
  taskId: TelegramMembershipTask,
): Promise<{ active: boolean; revoked: boolean; nextCheckAt: number | null }> {
  await ensureDatabaseSchema();
  const config = TELEGRAM_MEMBERSHIP_TASKS[taskId];
  const db = getTurso();
  const rowResult = await db.execute({
    sql: 'SELECT active, last_checked_at FROM task_claims WHERE telegram_id=? AND task_id=? AND period_key=?',
    args: [telegramId, config.dbId, 'once'],
  });
  const row = rowResult.rows[0];
  if (!row) return { active: false, revoked: false, nextCheckAt: null };
  if (Number(row.active ?? 1) === 0) return { active: false, revoked: false, nextCheckAt: null };

  const lastChecked = row.last_checked_at ? Date.parse(String(row.last_checked_at).replace(' ', 'T') + (String(row.last_checked_at).includes('Z') ? '' : 'Z')) : 0;
  const now = Date.now();
  if (lastChecked && now - lastChecked < CHECK_INTERVAL_MS) {
    return { active: true, revoked: false, nextCheckAt: lastChecked + CHECK_INTERVAL_MS };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('telegram_bot_not_configured');
  const joined = await isTelegramMember(token, config.chat, telegramId);
  const tx = await db.transaction('write');
  try {
    if (joined) {
      await tx.execute({
        sql: 'UPDATE task_claims SET last_checked_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND task_id=? AND period_key=? AND active=1',
        args: [telegramId, config.dbId, 'once'],
      });
      await tx.commit();
      return { active: true, revoked: false, nextCheckAt: now + CHECK_INTERVAL_MS };
    }

    const walletResult = await tx.execute({
      sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',
      args: [telegramId],
    });
    const balance = Number(walletResult.rows[0]?.coins_balance ?? 0);
    const deducted = Math.min(balance, config.reward);
    const newBalance = balance - deducted;
    if (deducted > 0) {
      await tx.execute({
        sql: 'UPDATE player_wallets SET coins_balance=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
        args: [newBalance, telegramId],
      });
      await tx.execute({
        sql: `INSERT INTO ledger_entries
          (id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json)
          VALUES(?,?,'coins','task_penalty',?,?,'task',?,?,?)`,
        args: [randomUUID(), telegramId, -deducted, newBalance, config.dbId,
          `task-penalty:${config.dbId}:${telegramId}:${randomUUID()}`,
          JSON.stringify({ taskId, reason: 'telegram_membership_left', requestedDeduction: config.reward })],
      });
    }
    await tx.execute({
      sql: 'UPDATE task_claims SET active=0,last_checked_at=CURRENT_TIMESTAMP,revoked_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND task_id=? AND period_key=? AND active=1',
      args: [telegramId, config.dbId, 'once'],
    });
    await tx.commit();
    return { active: false, revoked: true, nextCheckAt: null };
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export const TELEGRAM_MEMBERSHIP_CHECK_INTERVAL_MS = CHECK_INTERVAL_MS;
