import { randomUUID } from 'node:crypto';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';

export type LedgerAsset = 'coins' | 'oil';

export interface LedgerEntryInput {
  telegramId: string;
  asset: LedgerAsset;
  entryType: string;
  amount: number; // positive credits, negative debits
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}

export interface LedgerEntryResult {
  id: string;
  balance: number;
  duplicate: boolean;
}

/**
 * The only supported primitive for changing a player's persistent wallet.
 * Call it only from a server route after validating the gameplay/payment event.
 */
export async function postLedgerEntry(input: LedgerEntryInput): Promise<LedgerEntryResult> {
  if (!/^\d{1,24}$/.test(input.telegramId)) throw new Error('invalid_telegram_id');
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) throw new Error('invalid_ledger_amount');
  if (!input.idempotencyKey || input.idempotencyKey.length > 160) throw new Error('invalid_idempotency_key');
  if (!/^[a-z][a-z0-9_]{1,47}$/.test(input.entryType)) throw new Error('invalid_ledger_type');

  await ensureDatabaseSchema();
  const db = getTurso();
  const tx = await db.transaction('write');
  try {
    const previous = await tx.execute({
      sql: 'SELECT id, balance_after FROM ledger_entries WHERE idempotency_key = ?',
      args: [input.idempotencyKey],
    });
    if (previous.rows.length) {
      await tx.rollback();
      return {
        id: String(previous.rows[0].id),
        balance: Number(previous.rows[0].balance_after),
        duplicate: true,
      };
    }

    const wallet = await tx.execute({
      sql: `SELECT ${input.asset === 'coins' ? 'coins_balance' : 'oil_balance'} AS balance
            FROM player_wallets WHERE telegram_id = ?`,
      args: [input.telegramId],
    });
    if (!wallet.rows.length) throw new Error('player_wallet_not_found');
    const current = Number(wallet.rows[0].balance);
    const next = current + input.amount;
    if (!Number.isSafeInteger(next) || next < 0) throw new Error('insufficient_or_invalid_balance');

    const id = randomUUID();
    const nowMonth = new Date().toISOString().slice(0, 7);
    const nowDay = new Date().toISOString().slice(0, 10);
    const weekDate = new Date();
    const dayNum = weekDate.getUTCDay() || 7;
    weekDate.setUTCDate(weekDate.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((weekDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    const weekKey = `${weekDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;

    await tx.execute({
      sql: `UPDATE player_wallets SET
              ${input.asset === 'coins' ? 'coins_balance' : 'oil_balance'} = ?,
              ${input.asset === 'coins' && input.amount > 0 ? 'lifetime_coins_earned = lifetime_coins_earned + ?,' : ''}
              ${input.asset === 'oil' && input.amount < 0 ? 'lifetime_oil_sold = lifetime_oil_sold + ?,' : ''}
              updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = ?`,
      args: [
        next,
        ...(input.asset === 'coins' && input.amount > 0 ? [input.amount] : []),
        ...(input.asset === 'oil' && input.amount < 0 ? [-input.amount] : []),
        input.telegramId,
      ],
    });

    await tx.execute({
      sql: `INSERT INTO ledger_entries
        (id, telegram_id, asset, entry_type, amount, balance_after, reference_type, reference_id, idempotency_key, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, input.telegramId, input.asset, input.entryType, input.amount, next,
        input.referenceType ?? null, input.referenceId ?? null, input.idempotencyKey,
        input.metadata ? JSON.stringify(input.metadata) : null],
    });
    await tx.execute({
      sql: `INSERT INTO player_events(id, telegram_id, event_type, amount, metadata_json, idempotency_key)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), input.telegramId, input.entryType, input.amount,
        input.metadata ? JSON.stringify(input.metadata) : null, `event:${input.idempotencyKey}`],
    });

    if (input.asset === 'coins' && input.amount > 0) {
      await tx.execute({
        sql: `INSERT INTO player_monthly_stats(telegram_id, month_key, coins_earned)
              VALUES (?, ?, ?)
              ON CONFLICT(telegram_id, month_key) DO UPDATE SET
                coins_earned = coins_earned + excluded.coins_earned,
                updated_at = CURRENT_TIMESTAMP`,
        args: [input.telegramId, nowMonth, input.amount],
      });
      await tx.execute({
        sql: `INSERT INTO player_daily_stats(telegram_id, day_key, coins_earned)
              VALUES (?, ?, ?)
              ON CONFLICT(telegram_id, day_key) DO UPDATE SET
                coins_earned = coins_earned + excluded.coins_earned,
                updated_at = CURRENT_TIMESTAMP`,
        args: [input.telegramId, nowDay, input.amount],
      });
      await tx.execute({
        sql: `INSERT INTO player_weekly_stats(telegram_id, week_key, coins_earned)
              VALUES (?, ?, ?)
              ON CONFLICT(telegram_id, week_key) DO UPDATE SET
                coins_earned = coins_earned + excluded.coins_earned,
                updated_at = CURRENT_TIMESTAMP`,
        args: [input.telegramId, weekKey, input.amount],
      });
    }
    await tx.commit();
    return { id, balance: next, duplicate: false };
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
