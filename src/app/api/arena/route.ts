import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';
import { calculateArenaSettlement, isValidArenaEntryAmount } from '@/lib/arena-settlement.mjs';
import { broadcastGameInvite } from '@/lib/game-invite-notice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COUNTDOWN_MS = 30_000;
const SPIN_MS = 7_000;
const HOUSE_SLICE = 0.25;

type ArenaEntryRow = {
  telegram_id: string;
  amount: number;
  purchased_amount: number;
  wallet_amount: number;
  username?: string | null;
  first_name?: string | null;
  photo_url?: string | null;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function validAmount(value: unknown): value is number {
  return isValidArenaEntryAmount(value);
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
    purchased_amount: Number(row.purchased_amount ?? 0),
    wallet_amount: Number(row.wallet_amount ?? 0) || (Number(row.purchased_amount ?? 0) === 0 ? Number(row.amount) : 0),
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
  const houseThreshold = BigInt(Math.round(HOUSE_SLICE * 1_000_000_000_000));
  if (draw < houseThreshold) return { seed, winnerType: 'house' as const, winnerId: null, stopDegrees: 45 };
  const playerDraw = Number(draw - houseThreshold) / Number(1_000_000_000_000n - houseThreshold);
  const target = playerDraw * total;
  let cumulative = 0;
  let winner = entries[entries.length - 1];
  for (const entry of entries) { cumulative += entry.amount; if (target < cumulative) { winner = entry; break; } }
  const winnerIndex = entries.findIndex((entry) => entry.telegram_id === winner.telegram_id);
  const beforeWinner = entries.slice(0, winnerIndex).reduce((sum, entry) => sum + entry.amount, 0);
  // The CSS wheel uses conic-gradient(from -90deg): the 25% house
  // sector occupies [-90deg, 0deg], so player sectors start at 0deg.
  // The pointer is fixed at 0deg (top); rotate the wheel by the inverse
  // of the selected player's actual sector midpoint.
  const winnerCenter = ((beforeWinner + winner.amount / 2) / total) * 270;
  const stopDegrees = (360 - winnerCenter) % 360;
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
async function cancelAndRefundRound(
  db: ReturnType<typeof getTurso>,
  roundId: string,
  expectedStatus: 'open' | 'countdown',
  reason: string,
) {
  const tx = await db.transaction('write');
  try {
    const cancelled = await tx.execute({
      sql: "UPDATE arena_rounds SET status='cancelled',completed_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=? AND status=? RETURNING id",
      args: [roundId, expectedStatus],
    });
    if (!cancelled.rows.length) {
      await tx.rollback();
      return false;
    }
    const entryRows = await tx.execute({
      sql: 'SELECT telegram_id,amount,purchased_amount,wallet_amount FROM arena_entries WHERE round_id=? ORDER BY created_at,telegram_id',
      args: [roundId],
    });
    const entries: ArenaEntryRow[] = entryRows.rows.map((row) => ({
      telegram_id: String(row.telegram_id),
      amount: Number(row.amount),
      purchased_amount: Number(row.purchased_amount ?? 0),
      wallet_amount: Number(row.wallet_amount ?? 0) || (Number(row.purchased_amount ?? 0) === 0 ? Number(row.amount) : 0),
    }));
    const settlement = calculateArenaSettlement(entries.map((entry) => ({
      telegramId: entry.telegram_id,
      amount: entry.amount,
      purchasedAmount: entry.purchased_amount,
      walletAmount: entry.wallet_amount,
    })), null, null, true);
    for (const refund of settlement.refunds) {
      if (refund.purchasedAmount > 0) {
        const balance = await tx.execute({
          sql: "INSERT INTO bet_token_balances(telegram_id,balance) VALUES(?,?) ON CONFLICT(telegram_id) DO UPDATE SET balance=balance+excluded.balance,updated_at=CURRENT_TIMESTAMP RETURNING balance",
          args: [refund.telegramId, refund.purchasedAmount],
        });
        await tx.execute({
          sql: "INSERT INTO bet_token_transactions(id,telegram_id,transaction_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'refund',?,?, 'arena_round',?,?,?)",
          args: [randomUUID(), refund.telegramId, refund.purchasedAmount, Number(balance.rows[0].balance), roundId, `arena_cancel_purchased_refund:${roundId}:${refund.telegramId}`, JSON.stringify({ reason })],
        });
      }
      if (refund.walletAmount > 0) {
        const current = await tx.execute({
          sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',
          args: [refund.telegramId],
        });
        if (!current.rows.length) throw new Error('player_wallet_not_found_for_arena_refund');
        const balanceAfter = Number(current.rows[0].coins_balance) + refund.walletAmount;
        // Write the refund ledger marker before the wallet credit so the daily
        // cap trigger recognizes this arena refund as exempt.
        await tx.execute({
          sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','arena_refund',?,?, 'arena_round',?,?,?)",
          args: [randomUUID(), refund.telegramId, refund.walletAmount, balanceAfter, roundId, `arena_cancel_wallet_refund:${roundId}:${refund.telegramId}`, JSON.stringify({ reason, purchasedRefund: refund.purchasedAmount })],
        });
        const credited = await tx.execute({
          sql: 'UPDATE player_wallets SET coins_balance=coins_balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND coins_balance=?',
          args: [refund.walletAmount, refund.telegramId, Number(current.rows[0].coins_balance)],
        });
        if (Number(credited.rowsAffected) !== 1) throw new Error('player_wallet_refund_conflict');
      }
    }
    await tx.commit();
    return true;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

async function settleDueRounds(db: ReturnType<typeof getTurso>) {
  const now = Date.now();

  const dueCountdowns = await db.execute({
    sql: "SELECT id, outcome_seed, algorithm_version FROM arena_rounds WHERE status='countdown' AND starts_at <= ? ORDER BY created_at LIMIT 10",
    args: [now],
  });

  for (const candidate of dueCountdowns.rows) {
    const roundId = String(candidate.id);
    const entries = await readEntries(db, roundId);
    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);

    if (entries.length < 2) {
      await cancelAndRefundRound(db, roundId, 'countdown', 'insufficient_players');
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
      const settlement = calculateArenaSettlement(entries.map((entry) => ({
        telegramId: entry.telegram_id,
        amount: entry.amount,
        purchasedAmount: entry.purchased_amount,
        walletAmount: entry.wallet_amount,
      })), winnerType, winnerId);
      if (winnerType === 'player' && winnerId) {
        const winner = settlement.winnerRefund;
        if (!winner) throw new Error('arena_winner_entry_missing');
        if (winner.purchasedAmount > 0) {
          const restored = await tx.execute({sql:"UPDATE bet_token_balances SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? RETURNING balance",args:[winner.purchasedAmount,winnerId]});
          if (!restored.rows.length) throw new Error('bet_token_wallet_missing');
          await tx.execute({sql:"INSERT INTO bet_token_transactions(id,telegram_id,transaction_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'refund',?,?, 'arena_round',?,?,?)",args:[randomUUID(),winnerId,winner.purchasedAmount,Number(restored.rows[0].balance),roundId,`bet_token_winner_return:${roundId}:${winnerId}`,JSON.stringify({reason:'winner_original_stake_return'})]});
        }
        if (winner.walletAmount > 0) {
          const before = await tx.execute({sql:'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',args:[winnerId]});
          if (!before.rows.length) throw new Error('player_wallet_not_found');
          const afterBalance = Number(before.rows[0].coins_balance) + winner.walletAmount;
          await tx.execute({sql:"INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','arena_winner_stake_return',?,?, 'arena_round',?,?,?)",args:[randomUUID(),winnerId,winner.walletAmount,afterBalance,roundId,`arena_winner_stake_return:${roundId}:${winnerId}`,JSON.stringify({roundId})]});
          await tx.execute({sql:"UPDATE player_wallets SET coins_balance=coins_balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?",args:[winner.walletAmount,winnerId]});
        }
        const opponentPool = settlement.opponentPool;
        const fee = settlement.fee;
        const netWinnings = settlement.netWinnings;
        if (netWinnings > 0) {
          const before = await tx.execute({sql:'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',args:[winnerId]});
          if (!before.rows.length) throw new Error('player_wallet_not_found');
          const afterBalance = Number(before.rows[0].coins_balance) + netWinnings;
          await tx.execute({sql:"INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','arena_prize',?,?, 'arena_round',?,?,?)",args:[randomUUID(),winnerId,netWinnings,afterBalance,roundId,`arena_prize:${roundId}`,JSON.stringify({roundId,total,winnerStake:winner.amount,opponentPool,feeRate:0.1,fee,netWinnings})]});
          const credited = await tx.execute({sql:"UPDATE player_wallets SET coins_balance=coins_balance+?,lifetime_coins_earned=lifetime_coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? RETURNING coins_balance",args:[netWinnings,netWinnings,winnerId]});
          if (!credited.rows.length) throw new Error('player_wallet_not_found');
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

    const now = Date.now();
    const playerId = String(identity.id);
    await db.execute({
      sql: 'UPDATE players SET username=COALESCE(?, username), first_name=COALESCE(?, first_name), last_name=COALESCE(?, last_name), photo_url=COALESCE(?, photo_url) WHERE telegram_id=? AND (username IS NOT COALESCE(?, username) OR first_name IS NOT COALESCE(?, first_name) OR last_name IS NOT COALESCE(?, last_name) OR photo_url IS NOT COALESCE(?, photo_url))',
      args: [identity.username ?? null, identity.first_name ?? null, identity.last_name ?? null, identity.photo_url ?? null, playerId, identity.username ?? null, identity.first_name ?? null, identity.last_name ?? null, identity.photo_url ?? null],
    });
    const [walletResult, betWalletResult, activeResult] = await Promise.all([
      db.execute({
        sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',
        args: [playerId],
      }),
      db.execute({
        sql: 'SELECT balance FROM bet_token_balances WHERE telegram_id=?',
        args: [playerId],
      }),
      db.execute({
        sql: "SELECT * FROM arena_rounds WHERE status IN ('open','countdown','spinning') ORDER BY created_at DESC LIMIT 1",
      }),
    ]);
    const balance = Number(walletResult.rows[0]?.coins_balance ?? 0);
    const betBalance = Number(betWalletResult.rows[0]?.balance ?? 0);
    const activeRound = activeResult.rows[0];

    // Everyone sees the latest completed round so the winner is announced to spectators too.
    const personalPrevious = await db.execute({
      sql: `SELECT r.* FROM arena_rounds r
            WHERE r.status = 'completed'
            ORDER BY r.completed_at DESC LIMIT 1`,
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
        betBalance,
        entries: entries.map(toPublicEntry),
        lastResult: personalLastResult,
        source: 'turso',
      }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    return NextResponse.json({
      round: null,
      balance,
      betBalance,
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

  let body: { amount?: unknown; action?: unknown; roundId?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError('invalid_body');
  }
  if (body.action !== 'cancel' && !validAmount(body.amount)) return jsonError('minimum_100_required');
  if (body.action === 'cancel' && body.roundId !== undefined && (typeof body.roundId !== 'string' || body.roundId.length < 1 || body.roundId.length > 64)) return jsonError('invalid_round');

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    // Cancellation must run before settlement: GET polling may have already auto-cancelled
    // and refunded a one-player round at its deadline. The cancel path below is idempotent.
    if (body.action !== 'cancel') await settleDueRounds(db);

    const playerId = String(identity.id);
    const player = await db.execute({
      sql: "SELECT telegram_id FROM players WHERE telegram_id=? AND status='active'",
      args: [playerId],
    });
    if (!player.rows.length) return jsonError('player_not_found', 404);

    if (body.action === 'cancel') {
      const runCancel = async (): Promise<Response> => {
      const tx = await db.transaction('write');
      try {
        const active = typeof body.roundId === 'string'
          ? await tx.execute({ sql: 'SELECT id,status FROM arena_rounds WHERE id=?', args: [body.roundId] })
          : await tx.execute({ sql: "SELECT id,status FROM arena_rounds WHERE status IN ('open','cancelled') ORDER BY created_at DESC LIMIT 1" });
        if (!active.rows.length) { await tx.rollback(); return jsonError('no_cancellable_round', 409); }
        const roundId = String(active.rows[0].id);
        const roundStatus = String(active.rows[0].status);
        const entryResult = await tx.execute({
          sql: 'SELECT amount,purchased_amount,wallet_amount FROM arena_entries WHERE round_id=? AND telegram_id=?',
          args: [roundId, playerId],
        });
        if (!entryResult.rows.length) { await tx.rollback(); return jsonError('entry_not_found', 404); }
        // A concurrent state poll may already have auto-cancelled and refunded this
        // single-player round. Since status and refunds commit in the same transaction,
        // returning success here is safe and prevents a false cancellation error.
        if (roundStatus === 'cancelled') {
          const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [playerId] });
          const bet = await tx.execute({ sql: 'SELECT balance FROM bet_token_balances WHERE telegram_id=?', args: [playerId] });
          await tx.commit();
          return NextResponse.json({ ok: true, cancelled: true, alreadyCancelled: true, balance: Number(wallet.rows[0]?.coins_balance ?? 0), betBalance: Number(bet.rows[0]?.balance ?? 0) }, { headers: { 'Cache-Control': 'no-store, private' } });
        }
        if (roundStatus !== 'open') { await tx.rollback(); return jsonError('cancellation_locked_second_player_joined', 409); }
        const countResult = await tx.execute({
          sql: 'SELECT COUNT(*) AS count FROM arena_entries WHERE round_id=?',
          args: [roundId],
        });
        if (Number(countResult.rows[0]?.count ?? 0) !== 1) {
          await tx.rollback();
          return jsonError('cancellation_locked_second_player_joined', 409);
        }
        const cancelled = await tx.execute({
          sql: "UPDATE arena_rounds SET status='cancelled',completed_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=? AND status='open' AND (SELECT COUNT(*) FROM arena_entries WHERE round_id=?)=1 RETURNING id",
          args: [roundId, roundId],
        });
        if (!cancelled.rows.length) { await tx.rollback(); return jsonError('cancellation_locked_second_player_joined', 409); }
        const entry = entryResult.rows[0];
        const purchasedAmount = Number(entry.purchased_amount ?? 0);
        const walletAmount = Number(entry.wallet_amount ?? 0) || (purchasedAmount === 0 ? Number(entry.amount) : 0);
        if (purchasedAmount > 0) {
          const restored = await tx.execute({
            sql: 'UPDATE bet_token_balances SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? RETURNING balance',
            args: [purchasedAmount, playerId],
          });
          if (!restored.rows.length) throw new Error('bet_token_wallet_missing');
          await tx.execute({
            sql: "INSERT INTO bet_token_transactions(id,telegram_id,transaction_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'refund',?,?, 'arena_round',?,?,?)",
            args: [randomUUID(), playerId, purchasedAmount, Number(restored.rows[0].balance), roundId, `arena_cancel_purchased_refund:${roundId}:${playerId}`, JSON.stringify({ reason: 'player_cancelled_waiting_round' })],
          });
        }
        if (walletAmount > 0) {
          const current = await tx.execute({
            sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',
            args: [playerId],
          });
          if (!current.rows.length) throw new Error('player_wallet_not_found_for_arena_refund');
          const balanceAfter = Number(current.rows[0].coins_balance) + walletAmount;
          // Insert the refund ledger marker first; the daily-cap trigger checks
          // it before allowing this arena_round wallet credit.
          await tx.execute({
            sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','arena_refund',?,?, 'arena_round',?,?,?)",
            args: [randomUUID(), playerId, walletAmount, balanceAfter, roundId, `arena_cancel_wallet_refund:${roundId}:${playerId}`, JSON.stringify({ reason: 'player_cancelled_waiting_round', purchasedRefund: purchasedAmount })],
          });
          const restored = await tx.execute({
            sql: 'UPDATE player_wallets SET coins_balance=coins_balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND coins_balance=?',
            args: [walletAmount, playerId, Number(current.rows[0].coins_balance)],
          });
          if (Number(restored.rowsAffected) !== 1) throw new Error('player_wallet_refund_conflict');
        }
        await tx.execute({
          sql: "INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,'arena_entry_cancelled',?,?,?)",
          args: [randomUUID(), playerId, Number(entry.amount), JSON.stringify({ roundId, purchasedAmount, walletAmount }), `event:arena_entry_cancelled:${roundId}:${playerId}`],
        });
        const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [playerId] });
        const bet = await tx.execute({ sql: 'SELECT balance FROM bet_token_balances WHERE telegram_id=?', args: [playerId] });
        await tx.commit();
        return NextResponse.json({ ok: true, cancelled: true, balance: Number(wallet.rows[0]?.coins_balance ?? 0), betBalance: Number(bet.rows[0]?.balance ?? 0) }, { headers: { 'Cache-Control': 'no-store, private' } });
      } catch (error) {
        await tx.rollback();
        throw error;
      }
      };
      let lastError: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        try { return await runCancel(); }
        catch (error) {
          lastError = error;
          console.error('arena_cancel_attempt_failed', { attempt, error });
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
      console.error('arena_cancel_failed', lastError);
      return jsonError('arena_cancel_failed', 503);
    }

    if (!validAmount(body.amount)) return jsonError('minimum_100_required');

    const tx = await db.transaction('write');
    let roundId = '';
    let newBalance = 0;
    let invitePlayerName = '';
    let shouldBroadcastInvite = false;

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

      const playerProfile = await tx.execute({ sql: "SELECT COALESCE(username,first_name,'Player') AS display_name FROM players WHERE telegram_id=?", args: [playerId] });
      invitePlayerName = String(playerProfile.rows[0]?.display_name ?? 'Player');

      const alreadyJoined = await tx.execute({
        sql: 'SELECT id FROM arena_entries WHERE round_id=? AND telegram_id=?',
        args: [roundId, playerId],
      });
      if (alreadyJoined.rows.length) throw new Error('already_joined');

      const betWallet = await tx.execute({sql:'INSERT INTO bet_token_balances(telegram_id,balance) VALUES(?,0) ON CONFLICT(telegram_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP RETURNING balance',args:[playerId]});
      const walletSnapshot = await tx.execute({sql:'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',args:[playerId]});
      const purchasedAvailable = Number(betWallet.rows[0]?.balance ?? 0);
      const walletAvailable = Number(walletSnapshot.rows[0]?.coins_balance ?? 0);
      const purchasedAmount = Math.min(purchasedAvailable, body.amount);
      const walletAmount = body.amount - purchasedAmount;
      if (walletAvailable < walletAmount) throw new Error('insufficient_balance');
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
          JSON.stringify({ roundId, amount: body.amount, purchasedAmount, walletAmount }),
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

      if (entryCount === 1) {
        const notice = await tx.execute({
          sql: "INSERT OR IGNORE INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,'game_invite_broadcast',0,?,?)",
          args: [randomUUID(), playerId, JSON.stringify({ game: 'arena', roundId }), `game_invite:arena:${roundId}`],
        });
        shouldBroadcastInvite = Number(notice.rowsAffected ?? 0) === 1;
      }

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

    if (shouldBroadcastInvite) {
      await broadcastGameInvite(db, { game: 'arena', roundId, playerId, playerName: invitePlayerName });
    }

    return NextResponse.json({
      ok: true,
      roundId,
      balance: newBalance,
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'arena_join_failed';
    if (message === 'insufficient_balance' || message === 'insufficient_bet_balance') return jsonError('insufficient_balance', 409);
    if (message === 'player_not_found') return jsonError('player_not_found', 404);
    if (message === 'already_joined') return jsonError('already_joined', 409);
    if (message === 'round_closed_for_entries') return jsonError('round_starting', 409);
    console.error('arena_join_failed', error);
    return jsonError('arena_join_failed', 503);
  }
}
