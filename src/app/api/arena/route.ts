import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';
import { postLedgerEntry } from '@/lib/ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_ENTRY = 100;
const MAX_ENTRY = 1_000_000_000;
const COUNTDOWN_MS = 30_000;
const SPIN_MS = 7_000;
const HOUSE_SLICE = 0.25;
const WAITING_REFUND_MS = 60 * 60 * 1000;

type ArenaEntryRow = {
  telegram_id: string;
  amount: number;
  username?: string | null;
  first_name?: string | null;
  photo_url?: string | null;
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
    sql: `SELECT e.telegram_id, e.amount, e.purchased_amount, e.wallet_amount, p.username, p.first_name, p.photo_url
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
    photo_url: row.photo_url == null ? null : String(row.photo_url),
  }));
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function chooseOutcome(entries: ArenaEntryRow[], total: number, roundId: string, seed: string) {
  // Version 1 is deterministic: the seed commitment is stored before the round accepts entries.
  const draw = BigInt('0x' + sha256('aramco-arena-v1:' + roundId + ':' + seed).slice(0, 16)) % 1_000_000_000_000n;
  const houseThreshold = 250_000_000_000n;
  if (draw < houseThreshold) return { seed, winnerType: 'house' as const, winnerId: null, stopDegrees: 45 };
  const playerDraw = Number(draw - houseThreshold) / Number(1_000_000_000_000n - houseThreshold);
  const target = playerDraw * total;
  let cumulative = 0;
  let winner = entries[entries.length - 1];
  for (const entry of entries) { cumulative += entry.amount; if (target < cumulative) { winner = entry; break; } }
  const winnerIndex = entries.findIndex((entry) => entry.telegram_id === winner.telegram_id);
  const beforeWinner = entries.slice(0, winnerIndex).reduce((sum, entry) => sum + entry.amount, 0);
  const winnerCenter = 90 + ((beforeWinner + winner.amount / 2) / total) * 270;
  const stopDegrees = (360 - winnerCenter + 360) % 360;
  return { seed, winnerType: 'player' as const, winnerId: winner.telegram_id, stopDegrees };
}

function resultProofHash(roundId: string, seed: string, winnerType: string, winnerId: string | null, total: number, stopDegrees: number, entries: ArenaEntryRow[]) {
  const canonicalEntries = [...entries].sort((a, b) => a.telegram_id.localeCompare(b.telegram_id)).map((entry) => [entry.telegram_id, entry.amount]);
  return sha256(JSON.stringify({ version: 1, roundId, seed, winnerType, winnerId, total, stopDegrees, entries: canonicalEntries }));
}

/**
 * The countdown transition commits the random outcome BEFORE the animation.
 * A retry therefore cannot reroll a round. The prize is credited idempotently
 * before the round is marked complete, so a transient failure cannot lose a win.
 */
async function settleDueRounds(db: ReturnType<typeof getTurso>) {
  const now = Date.now();

  // An unpaired entry expires one hour after the round was created.
  const expiredWaiting = await db.execute({
    sql: "SELECT id FROM arena_rounds WHERE status='open' AND created_at <= datetime('now', '-1 hour') ORDER BY created_at LIMIT 25",
  });
  for (const candidate of expiredWaiting.rows) {
    const roundId = String(candidate.id);
    const entries = await readEntries(db, roundId);
    const cancelled = await db.execute({
      sql: "UPDATE arena_rounds SET status='cancelled', completed_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=? AND status='open' AND created_at <= datetime('now', '-1 hour')",
      args: [roundId],
    });
    if (Number(cancelled.rowsAffected) === 1) {
      for (const entry of entries) {
        await postLedgerEntry({
          telegramId: entry.telegram_id,
          asset: 'coins',
          entryType: 'arena_refund',
          amount: entry.amount,
          idempotencyKey: `arena_waiting_refund:${roundId}:${entry.telegram_id}`,
          referenceType: 'arena_round',
          referenceId: roundId,
          metadata: { reason: 'waiting_timeout' },
        });
      }
    }
  }

  const dueCountdowns = await db.execute({
    sql: "SELECT id, outcome_seed, algorithm_version FROM arena_rounds WHERE status='countdown' AND starts_at <= ? ORDER BY created_at LIMIT 10",
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

    const seed = candidate.outcome_seed == null ? randomBytes(32).toString('hex') : String(candidate.outcome_seed);
        const algorithmVersion = Number(candidate.algorithm_version ?? 0);
        const outcome = chooseOutcome(entries, total, roundId, seed);
        const commitment = sha256(seed);
        const proofHash = algorithmVersion === 1 ? resultProofHash(roundId, seed, outcome.winnerType, outcome.winnerId, total, outcome.stopDegrees, entries) : null;
    await db.execute({
      sql: `UPDATE arena_rounds
            SET status='spinning', spin_started_at=?, total_entries=?,
                winner_telegram_id=?, winner_type=?, winning_amount=?,
                outcome_seed=?, seed_commitment=COALESCE(seed_commitment, ?), outcome_proof_hash=?, wheel_stop_degrees=?
            WHERE id=? AND status='countdown' AND starts_at<=?`,
      args: [
        now,
        total,
        outcome.winnerId,
        outcome.winnerType,
        outcome.winnerType === 'player' ? total : 0,
        seed,
        commitment,
        proofHash,
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
    const entries = await readEntries(db, roundId);
    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
    const tx = await db.transaction('write');
    try {
      const current = await tx.execute({sql:"SELECT status FROM arena_rounds WHERE id=?",args:[roundId]});
      if (!current.rows.length || String(current.rows[0].status) !== 'spinning') { await tx.rollback(); continue; }
      if (winnerType === 'player' && winnerId) {
        const winner = entries.find((entry) => entry.telegram_id === winnerId);
        if (!winner) throw new Error('arena_winner_entry_missing');
        if (winner.purchased_amount > 0) {
          const restored = await tx.execute({sql:"UPDATE bet_token_balances SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? RETURNING balance",args:[winner.purchased_amount,winnerId]});
          if (!restored.rows.length) throw new Error('bet_token_wallet_missing');
          await tx.execute({sql:"INSERT INTO bet_token_transactions(id,telegram_id,transaction_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'refund',?,?, 'arena_round',?,?,?)",args:[randomUUID(),winnerId,winner.purchased_amount,Number(restored.rows[0].balance),roundId,`bet_token_winner_return:${roundId}:${winnerId}`,JSON.stringify({reason:'winner_original_stake_return'})]});
        }
        if (winner.wallet_amount > 0) {
          const restoredWallet = await tx.execute({sql:"UPDATE player_wallets SET coins_balance=coins_balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? RETURNING coins_balance",args:[winner.wallet_amount,winnerId]});
          if (!restoredWallet.rows.length) throw new Error('player_wallet_not_found');
          await tx.execute({sql:"INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','arena_winner_stake_return',?,?, 'arena_round',?,?,?)",args:[randomUUID(),winnerId,winner.wallet_amount,Number(restoredWallet.rows[0].coins_balance),roundId,`arena_winner_stake_return:${roundId}:${winnerId}`,JSON.stringify({roundId})]});
        }
        const opponentPool = total - winner.amount;
        const fee = Math.floor(opponentPool * 0.10);
        const netWinnings = opponentPool - fee;
        if (netWinnings > 0) {
          const credited = await tx.execute({sql:"UPDATE player_wallets SET coins_balance=coins_balance+?,lifetime_coins_earned=lifetime_coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? RETURNING coins_balance",args:[netWinnings,netWinnings,winnerId]});
          if (!credited.rows.length) throw new Error('player_wallet_not_found');
          await tx.execute({sql:"INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','arena_prize',?,?, 'arena_round',?,?,?)",args:[randomUUID(),winnerId,netWinnings,Number(credited.rows[0].coins_balance),roundId,`arena_prize:${roundId}`,JSON.stringify({roundId,total,winnerStake:winner.amount,opponentPool,feeRate:0.1,fee,netWinnings})]});
          await tx.execute({sql:"INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,'arena_prize',?,?,?)",args:[randomUUID(),winnerId,netWinnings,JSON.stringify({roundId,opponentPool,fee,netWinnings}),`event:arena_prize:${roundId}`]});
        }
        await tx.execute({sql:"UPDATE player_monthly_stats SET coins_earned=coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND month_key=?",args:[netWinnings,winnerId,new Date().toISOString().slice(0,7)]});
        await tx.execute({sql:"INSERT INTO admin_audit_logs(id,admin_id,action,target_type,target_id,details_json) VALUES(?,'system','arena_round_fee_collected','arena_round',?,?)",args:[randomUUID(),roundId,JSON.stringify({winnerId,total,opponentPool,fee,netWinnings,feeRate:0.1})]});
      }
      const completed = await tx.execute({sql:"UPDATE arena_rounds SET status='completed',completed_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=? AND status='spinning'",args:[roundId]});
      if(Number(completed.rowsAffected)===1) await tx.execute({sql:"INSERT INTO admin_audit_logs(id,admin_id,action,target_type,target_id,details_json) VALUES(?,'system','arena_round_settled','arena_round',?,?)",args:[randomUUID(),roundId,JSON.stringify({winnerType,winnerId,totalEntries:total})]});
      await tx.commit();
    } catch(error) { await tx.rollback(); throw error; }
  }
}

function toPublicEntry(entry: ArenaEntryRow) {
  return {
    telegramId: entry.telegram_id,
    username: entry.username || entry.first_name || 'Player',
    amount: entry.amount,
    photoUrl: entry.photo_url || null,
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
    await db.execute({
      sql: 'UPDATE players SET username=COALESCE(?, username), first_name=COALESCE(?, first_name), last_name=COALESCE(?, last_name), photo_url=COALESCE(?, photo_url) WHERE telegram_id=?',
      args: [identity.username ?? null, identity.first_name ?? null, identity.last_name ?? null, identity.photo_url ?? null, playerId],
    });
    const [walletResult, activeResult] = await Promise.all([
      db.execute({
        sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',
        args: [playerId],
      }),
      db.execute({
        sql: "SELECT * FROM arena_rounds WHERE status IN ('open','countdown','spinning') ORDER BY created_at DESC LIMIT 1",
      }),
    ]);

    const betWalletResult = await db.execute({sql:'SELECT balance FROM bet_token_balances WHERE telegram_id=?',args:[playerId]});
    const balance = Number(walletResult.rows[0]?.coins_balance ?? 0);
    const betBalance = Number(betWalletResult.rows[0]?.balance ?? 0);
    const activeRound = activeResult.rows[0];

    // Return only this player's most recent completed round, never another
    // player's unrelated global result. This remains available while a new
    // round is active and while the player was offline at settlement time.
    const personalPrevious = await db.execute({
      sql: `SELECT r.* FROM arena_rounds r
            INNER JOIN arena_entries e ON e.round_id = r.id
            WHERE e.telegram_id = ? AND r.status = 'completed'
            ORDER BY r.completed_at DESC LIMIT 1`,
      args: [playerId],
    });
    const personalRow = personalPrevious.rows[0];
    let personalLastResult: { id: string; winnerType: string; winnerTelegramId: string | null; totalEntries: number; wheelStopDegrees: number; completedAt: string | null; seedCommitment: string | null; outcomeSeed: string | null; algorithmVersion: number; resultProofHash: string | null; entries: ReturnType<typeof toPublicEntry>[] } | null = null;
    if (personalRow) {
      const personalEntries = await readEntries(db, String(personalRow.id));
      personalLastResult = {
        id: String(personalRow.id),
        winnerType: String(personalRow.winner_type),
        winnerTelegramId: personalRow.winner_telegram_id == null ? null : String(personalRow.winner_telegram_id),
        totalEntries: Number(personalRow.total_entries),
        wheelStopDegrees: personalRow.wheel_stop_degrees == null ? 0 : Number(personalRow.wheel_stop_degrees),
        completedAt: personalRow.completed_at == null ? null : String(personalRow.completed_at),
        seedCommitment: personalRow.seed_commitment == null ? null : String(personalRow.seed_commitment),
        outcomeSeed: Number(personalRow.algorithm_version ?? 0) === 1 ? String(personalRow.outcome_seed ?? '') : null,
        algorithmVersion: Number(personalRow.algorithm_version ?? 0),
        resultProofHash: personalRow.outcome_proof_hash == null ? null : String(personalRow.outcome_proof_hash),
        entries: personalEntries.map(toPublicEntry),
      };
    }

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
          seedCommitment: activeRound.seed_commitment == null ? null : String(activeRound.seed_commitment),
          algorithmVersion: Number(activeRound.algorithm_version ?? 0),
        },
        balance,
        entries: entries.map(toPublicEntry),
        lastResult: personalLastResult,
        source: 'turso',
      }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    return NextResponse.json({
      round: null,
      balance,
      entries: [],
      lastResult: personalLastResult,
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
  if (!validAmount(body.amount)) return jsonError('minimum_100_required');

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
        const committedSeed = randomBytes(32).toString('hex');
        await tx.execute({
          sql: "INSERT INTO arena_rounds(id, status, outcome_seed, seed_commitment, algorithm_version) VALUES (?, 'open', ?, ?, 1)",
          args: [roundId, committedSeed, sha256(committedSeed)],
        });
      }

      const alreadyJoined = await tx.execute({
        sql: 'SELECT id FROM arena_entries WHERE round_id=? AND telegram_id=?',
        args: [roundId, playerId],
      });
      if (alreadyJoined.rows.length) throw new Error('already_joined');

      const betWallet = await tx.execute({sql:'INSERT INTO bet_token_balances(telegram_id,balance) VALUES(?,0) ON CONFLICT(telegram_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP RETURNING balance',args:[playerId]});
      const purchasedAmount = Math.min(Number(betWallet.rows[0]?.balance ?? 0), body.amount);
      const walletAmount = body.amount - purchasedAmount;
      if (walletAmount > 0) {
        const debit = await tx.execute({sql:`UPDATE player_wallets SET coins_balance=coins_balance-?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND coins_balance>=? RETURNING coins_balance`,args:[walletAmount,playerId,walletAmount]});
        if(!debit.rows.length) throw new Error('insufficient_balance');
        newBalance=Number(debit.rows[0].coins_balance);
        await tx.execute({sql:`INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','arena_entry',?,?,'arena_round',?,?,?)`,args:[randomUUID(),playerId,-walletAmount,newBalance,roundId,`arena_entry:${roundId}:${playerId}:wallet`,JSON.stringify({roundId,purchasedAmount,walletAmount})]});
      } else {
        const currentWallet=await tx.execute({sql:'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',args:[playerId]});
        newBalance=Number(currentWallet.rows[0]?.coins_balance??0);
      }
      if(purchasedAmount>0) {
        const debited=await tx.execute({sql:'UPDATE bet_token_balances SET balance=balance-?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND balance>=? RETURNING balance',args:[purchasedAmount,playerId,purchasedAmount]});
        if(!debited.rows.length) throw new Error('insufficient_bet_balance');
        await tx.execute({sql:"INSERT INTO bet_token_transactions(id,telegram_id,transaction_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'stake',?,?, 'arena_round',?,?,?)",args:[randomUUID(),playerId,-purchasedAmount,Number(debited.rows[0].balance),roundId,`bet_token_stake:${roundId}:${playerId}`,JSON.stringify({roundId})]});
      }



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
        args: [playerId, monthKey, walletAmount],
      });

      await tx.execute({
        sql: 'INSERT INTO arena_entries(id, round_id, telegram_id, amount, purchased_amount, wallet_amount) VALUES (?, ?, ?, ?, ?, ?)',
        args: [randomUUID(), roundId, playerId, body.amount, purchasedAmount, walletAmount],
      });
      // A wheel expansion lasts for 72 hours or five arena bets, whichever
      // happens first. Consume one use only after the player's bet is recorded.
      const wheelExpansion = await tx.execute({
        sql: `SELECT payment_id, usage_count FROM player_special_parts
          WHERE telegram_id=? AND part_id='wheel_expansion'
            AND expires_at>? AND usage_count<5
          ORDER BY purchased_at DESC LIMIT 1`,
        args: [playerId, Date.now()],
      });
      if (wheelExpansion.rows.length) {
        const paymentId = String(wheelExpansion.rows[0].payment_id);
        const used = Number(wheelExpansion.rows[0].usage_count ?? 0);
        const now = Date.now();
        await tx.execute({
          sql: `UPDATE player_special_parts
            SET usage_count=usage_count+1,
                expires_at=CASE WHEN usage_count+1>=5 THEN ? ELSE expires_at END
            WHERE payment_id=? AND usage_count=? AND expires_at>?`,
          args: [now, paymentId, used, now],
        });
      }

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
