import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';
import { postLedgerEntry } from '@/lib/ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_ENTRY = 1_000;
const MAX_ENTRY = 1_000_000_000;
const COUNTDOWN_MS = 30_000;
const SPIN_MS = 7_000;
const HOUSE_SLICE = 0.25;

type ArenaEntryRow = {
  telegram_id: string;
  amount: number;
  username?: string | null;
  first_name?: string | null;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function validAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= MIN_ENTRY && value <= MAX_ENTRY;
}

async function readEntries(db: ReturnType<typeof getTurso>, roundId: string): Promise<ArenaEntryRow[]> {
  const result = await db.execute({
    sql: `SELECT e.telegram_id, e.amount, p.username, p.first_name
          FROM arena_entries e
          JOIN players p ON p.telegram_id = e.telegram_id
          WHERE e.round_id = ?
          ORDER BY e.created_at, e.telegram_id`,
    args: [roundId],
  });
  return result.rows.map((row) => ({
    telegram_id: String(row.telegram_id),
    amount: Number(row.amount),
    username: row.username == null ? null : String(row.username),
    first_name: row.first_name == null ? null : String(row.first_name),
  }));
}

function chooseOutcome(entries: ArenaEntryRow[], total: number) {
  const seed = randomBytes(32).toString('hex');

  const roll = randomInt(0, 1_000_000);
  if (roll < HOUSE_SLICE * 1_000_000) {
    return { seed, winnerType: 'house' as const, winnerId: null, stopDegrees: 315 };
  }

  const playerRoll = ((roll / 1_000_000) - HOUSE_SLICE) / (1 - HOUSE_SLICE);
  const target = playerRoll * total;
  let cumulative = 0;
  let winner = entries[entries.length - 1];

  for (const entry of entries) {
    cumulative += entry.amount;
    if (target < cumulative) {
      winner = entry;
      break;
    }
  }

  const beforeWinner = entries
    .slice(0, entries.findIndex((entry) => entry.telegram_id === winner.telegram_id))
    .reduce((sum, entry) => sum + entry.amount, 0);
  const winnerCenter = (HOUSE_SLICE * 360) +
    ((beforeWinner + winner.amount / 2) / total) * ((1 - HOUSE_SLICE) * 360);
  const stopDegrees = (360 - winnerCenter + 360) % 360;

  return {
    seed,
    winnerType: 'player' as const,
    winnerId: winner.telegram_id,
    stopDegrees,
  };
}

/**
 * The countdown transition commits the random outcome BEFORE the animation.
 * A retry therefore cannot reroll a round. The prize is credited idempotently
 * before the round is marked complete, so a transient failure cannot lose a win.
 */
async function settleDueRounds(db: ReturnType<typeof getTurso>) {
  const now = Date.now();

  const dueCountdowns = await db.execute({
    sql: "SELECT id FROM arena_rounds WHERE status='countdown' AND starts_at <= ? ORDER BY created_at LIMIT 10",
    args: [now],
  });

  for (const candidate of dueCountdowns.rows) {
    const roundId = String(candidate.id);
    const entries = await readEntries(db, roundId);
    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);

    if (entries.length < 2) {
      const cancelled = await db.execute({
        sql: "UPDATE arena_rounds SET status='cancelled', completed_at=CURRENT_TIMESTAMP WHERE id=? AND status='countdown'",
        args: [roundId],
      });
      if (Number(cancelled.rowsAffected) === 1) {
        for (const entry of entries) {
          await postLedgerEntry({
            telegramId: entry.telegram_id,
            asset: 'coins',
            entryType: 'arena_refund',
            amount: entry.amount,
            idempotencyKey: `arena_refund:${roundId}:${entry.telegram_id}`,
            referenceType: 'arena_round',
            referenceId: roundId,
          });
        }
      }
      continue;
    }

    const outcome = chooseOutcome(entries, total);
    await db.execute({
      sql: `UPDATE arena_rounds
            SET status='spinning', spin_started_at=?, total_entries=?,
                winner_telegram_id=?, winner_type=?, winning_amount=?,
                outcome_seed=?, wheel_stop_degrees=?
            WHERE id=? AND status='countdown' AND starts_at<=?`,
      args: [
        now,
        total,
        outcome.winnerId,
        outcome.winnerType,
        outcome.winnerType === 'player' ? total : 0,
        outcome.seed,
        outcome.stopDegrees,
        roundId,
        now,
      ],
    });
  }

  const dueSpins = await db.execute({
    sql: "SELECT id, winner_type, winner_telegram_id, total_entries FROM arena_rounds WHERE status='spinning' AND spin_started_at <= ? ORDER BY created_at LIMIT 10",
    args: [now - SPIN_MS],
  });

  for (const spin of dueSpins.rows) {
    const roundId = String(spin.id);
    const winnerType = String(spin.winner_type);
    const winnerId = spin.winner_telegram_id == null ? null : String(spin.winner_telegram_id);
    const total = Number(spin.total_entries);

    if (winnerType === 'player' && winnerId) {
      await postLedgerEntry({
        telegramId: winnerId,
        asset: 'coins',
        entryType: 'arena_prize',
        amount: total,
        idempotencyKey: `arena_prize:${roundId}`,
        referenceType: 'arena_round',
        referenceId: roundId,
        metadata: { roundId, entries: (await readEntries(db, roundId)).length },
      });
    }

    const completed = await db.execute({
      sql: "UPDATE arena_rounds SET status='completed', completed_at=CURRENT_TIMESTAMP WHERE id=? AND status='spinning'",
      args: [roundId],
    });

    if (Number(completed.rowsAffected) === 1) {
      await db.execute({
        sql: `INSERT INTO admin_audit_logs
              (id, admin_id, action, target_type, target_id, details_json)
              VALUES (?, 'system', 'arena_round_settled', 'arena_round', ?, ?)`,
        args: [
          randomUUID(),
          roundId,
          JSON.stringify({ winnerType, winnerId, totalEntries: total }),
        ],
      });
    }
  }
}

function toPublicEntry(entry: ArenaEntryRow) {
  return {
    telegramId: entry.telegram_id,
    username: entry.username || entry.first_name || 'Player',
    amount: entry.amount,
  };
}

export async function GET(req: NextRequest) {
  const identity = verifiedPlayerFromRequest(req);
  if (!identity) return jsonError('telegram_auth_required', 401);

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    await settleDueRounds(db);

    const playerId = String(identity.id);
    const [walletResult, activeResult] = await Promise.all([
      db.execute({
        sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',
        args: [playerId],
      }),
      db.execute({
        sql: "SELECT * FROM arena_rounds WHERE status IN ('open','countdown','spinning') ORDER BY created_at DESC LIMIT 1",
      }),
    ]);

    const balance = Number(walletResult.rows[0]?.coins_balance ?? 0);
    const activeRound = activeResult.rows[0];

    if (activeRound) {
      const entries = await readEntries(db, String(activeRound.id));
      return NextResponse.json({
        round: {
          id: String(activeRound.id),
          status: String(activeRound.status),
          startsAt: activeRound.starts_at == null ? null : Number(activeRound.starts_at),
          spinStartedAt: activeRound.spin_started_at == null ? null : Number(activeRound.spin_started_at),
          totalEntries: Number(activeRound.total_entries),
          entriesCount: entries.length,
          winnerType: activeRound.winner_type == null ? null : String(activeRound.winner_type),
          winnerTelegramId: activeRound.winner_telegram_id == null ? null : String(activeRound.winner_telegram_id),
          wheelStopDegrees: activeRound.wheel_stop_degrees == null ? null : Number(activeRound.wheel_stop_degrees),
        },
        balance,
        entries: entries.map(toPublicEntry),
        lastResult: null,
        source: 'turso',
      }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    const previousResult = await db.execute({
      sql: "SELECT * FROM arena_rounds WHERE status='completed' ORDER BY completed_at DESC LIMIT 1",
    });
    const last = previousResult.rows[0];
    let lastResult = null;

    if (last) {
      const entries = await readEntries(db, String(last.id));
      lastResult = {
        id: String(last.id),
        winnerType: String(last.winner_type),
        winnerTelegramId: last.winner_telegram_id == null ? null : String(last.winner_telegram_id),
        totalEntries: Number(last.total_entries),
        wheelStopDegrees: last.wheel_stop_degrees == null ? 0 : Number(last.wheel_stop_degrees),
        entries: entries.map(toPublicEntry),
      };
    }

    return NextResponse.json({
      round: null,
      balance,
      entries: [],
      lastResult,
      source: 'turso',
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('arena_state_failed', error);
    return jsonError('arena_unavailable', 503);
  }
}

export async function POST(req: NextRequest) {
  const identity = verifiedPlayerFromRequest(req);
  if (!identity) return jsonError('telegram_auth_required', 401);

  let body: { amount?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError('invalid_body');
  }
  if (!validAmount(body.amount)) return jsonError('minimum_1000_required');

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    await settleDueRounds(db);

    const playerId = String(identity.id);
    const player = await db.execute({
      sql: "SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'",
      args: [playerId],
    });
    if (!player.rows.length) return jsonError('player_not_found', 404);

    const tx = await db.transaction('write');
    let roundId = '';
    let newBalance = 0;

    try {
      const active = await tx.execute({
        sql: "SELECT id, status, starts_at FROM arena_rounds WHERE status IN ('open','countdown','spinning') ORDER BY created_at DESC LIMIT 1",
      });
      const activeRound = active.rows[0];

      if (activeRound) {
        const status = String(activeRound.status);
        const startsAt = activeRound.starts_at == null ? null : Number(activeRound.starts_at);
        if (status === 'spinning' || (startsAt !== null && startsAt <= Date.now())) {
          throw new Error('round_closed_for_entries');
        }
        roundId = String(activeRound.id);
      } else {
        roundId = randomUUID();
        await tx.execute({
          sql: "INSERT INTO arena_rounds(id, status) VALUES (?, 'open')",
          args: [roundId],
        });
      }

      const alreadyJoined = await tx.execute({
        sql: 'SELECT id FROM arena_entries WHERE round_id=? AND telegram_id=?',
        args: [roundId, playerId],
      });
      if (alreadyJoined.rows.length) throw new Error('already_joined');

      const debit = await tx.execute({
        sql: `UPDATE player_wallets
              SET coins_balance=coins_balance-?, updated_at=CURRENT_TIMESTAMP
              WHERE telegram_id=? AND coins_balance>=?
              RETURNING coins_balance`,
        args: [body.amount, playerId, body.amount],
      });
      if (!debit.rows.length) throw new Error('insufficient_balance');
      newBalance = Number(debit.rows[0].coins_balance);

      await tx.execute({
        sql: `INSERT INTO ledger_entries
              (id, telegram_id, asset, entry_type, amount, balance_after,
               reference_type, reference_id, idempotency_key, metadata_json)
              VALUES (?, ?, 'coins', 'arena_entry', ?, ?, 'arena_round', ?, ?, ?)`,
        args: [
          randomUUID(),
          playerId,
          -body.amount,
          newBalance,
          roundId,
          `arena_entry:${roundId}:${playerId}`,
          JSON.stringify({ roundId, amount: body.amount }),
        ],
      });

      await tx.execute({
        sql: `INSERT INTO player_events
              (id, telegram_id, event_type, amount, metadata_json, idempotency_key)
              VALUES (?, ?, 'arena_entry', ?, ?, ?)`,
        args: [
          randomUUID(),
          playerId,
          -body.amount,
          JSON.stringify({ roundId, amount: body.amount }),
          `event:arena_entry:${roundId}:${playerId}`,
        ],
      });

      const monthKey = new Date().toISOString().slice(0, 7);
      await tx.execute({
        sql: `INSERT INTO player_monthly_stats(telegram_id, month_key, coins_spent)
              VALUES (?, ?, ?)
              ON CONFLICT(telegram_id, month_key) DO UPDATE SET
                coins_spent=coins_spent+excluded.coins_spent,
                updated_at=CURRENT_TIMESTAMP`,
        args: [playerId, monthKey, body.amount],
      });

      await tx.execute({
        sql: 'INSERT INTO arena_entries(id, round_id, telegram_id, amount) VALUES (?, ?, ?, ?)',
        args: [randomUUID(), roundId, playerId, body.amount],
      });

      const counts = await tx.execute({
        sql: 'SELECT COUNT(*) AS entry_count, SUM(amount) AS total FROM arena_entries WHERE round_id=?',
        args: [roundId],
      });
      const entryCount = Number(counts.rows[0]?.entry_count ?? 0);
      const total = Number(counts.rows[0]?.total ?? 0);

      await tx.execute({
        sql: 'UPDATE arena_rounds SET total_entries=? WHERE id=?',
        args: [total, roundId],
      });

      if (entryCount >= 2) {
        await tx.execute({
          sql: "UPDATE arena_rounds SET status='countdown', starts_at=? WHERE id=? AND status='open'",
          args: [Date.now() + COUNTDOWN_MS, roundId],
        });
      }

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }

    return NextResponse.json({
      ok: true,
      roundId,
      balance: newBalance,
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'arena_join_failed';
    if (message === 'insufficient_balance') return jsonError('insufficient_balance', 409);
    if (message === 'already_joined') return jsonError('already_joined', 409);
    if (message === 'round_closed_for_entries') return jsonError('round_starting', 409);
    console.error('arena_join_failed', error);
    return jsonError('arena_join_failed', 503);
  }
}
