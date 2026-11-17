import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';
import { makeCrashPoint, multiplierAt, crashPayout } from '@/lib/crash-game.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BETTING_MS = 50_000;
const CRASH_WAIT_MS = 50_000;
const MIN_BET = 100;

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}
function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
async function advanceRound(db: ReturnType<typeof getTurso>) {
  const now = Date.now();
  const tx = await db.transaction('write');
  try {
    let latest = await tx.execute({ sql: 'SELECT * FROM crash_rounds ORDER BY created_at DESC, rowid DESC LIMIT 1' });
    if (!latest.rows.length) {
      const id = randomUUID();
      const seed = randomBytes(32).toString('hex');
      await tx.execute({
        sql: "INSERT INTO crash_rounds(id,status,betting_ends_at,crash_multiplier,server_seed,seed_hash) VALUES(?,'countdown',?,?,?,?)",
        args: [id, now + BETTING_MS, makeCrashPoint(seed, id), seed, hash(seed)],
      });
    } else {
      const round = latest.rows[0];
      const status = String(round.status);
      if (status === 'countdown' && Number(round.betting_ends_at) <= now) {
        await tx.execute({ sql: "UPDATE crash_rounds SET status='running',started_at=? WHERE id=? AND status='countdown'", args: [now, String(round.id)] });
        if (Number(round.crash_multiplier) <= 1) {
          await tx.execute({ sql: "UPDATE crash_rounds SET status='crashed',crashed_at=? WHERE id=? AND status='running'", args: [now, String(round.id)] });
          const burned = await tx.execute({ sql: "SELECT COALESCE(SUM(amount),0) AS total FROM crash_bets WHERE round_id=? AND status='active'", args: [String(round.id)] });
          const burnedAmount = Number(burned.rows[0]?.total ?? 0);
          if (burnedAmount > 0) await tx.execute({ sql: 'UPDATE crash_house_pool SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE id=1', args: [burnedAmount] });
          await tx.execute({ sql: "UPDATE crash_bets SET status='lost',settled_at=CURRENT_TIMESTAMP WHERE round_id=? AND status='active'", args: [String(round.id)] });
          const nextId = randomUUID();
          const nextSeed = randomBytes(32).toString('hex');
          await tx.execute({
            sql: "INSERT INTO crash_rounds(id,status,betting_ends_at,crash_multiplier,server_seed,seed_hash) VALUES(?,'countdown',?,?,?,?)",
            args: [nextId, now + BETTING_MS, makeCrashPoint(nextSeed, nextId), nextSeed, hash(nextSeed)],
          });
        }
      } else if (status === 'running') {
        const start = Number(round.started_at ?? now);
        if (multiplierAt(start, now) >= Number(round.crash_multiplier)) {
          await tx.execute({ sql: "UPDATE crash_rounds SET status='crashed',crashed_at=? WHERE id=? AND status='running'", args: [now, String(round.id)] });
          const burned = await tx.execute({ sql: "SELECT COALESCE(SUM(amount),0) AS total FROM crash_bets WHERE round_id=? AND status='active'", args: [String(round.id)] });
          const burnedAmount = Number(burned.rows[0]?.total ?? 0);
          if (burnedAmount > 0) await tx.execute({ sql: 'UPDATE crash_house_pool SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE id=1', args: [burnedAmount] });
          await tx.execute({ sql: "UPDATE crash_bets SET status='lost',settled_at=CURRENT_TIMESTAMP WHERE round_id=? AND status='active'", args: [String(round.id)] });
          const nextId = randomUUID();
          const nextSeed = randomBytes(32).toString('hex');
          await tx.execute({
            sql: "INSERT INTO crash_rounds(id,status,betting_ends_at,crash_multiplier,server_seed,seed_hash) VALUES(?,'countdown',?,?,?,?)",
            args: [nextId, now + BETTING_MS, makeCrashPoint(nextSeed, nextId), nextSeed, hash(nextSeed)],
          });
        }
      } else if (status === 'crashed' && Number(round.crashed_at ?? now) + CRASH_WAIT_MS <= now) {
        const id = randomUUID();
        const seed = randomBytes(32).toString('hex');
        await tx.execute({
          sql: "INSERT INTO crash_rounds(id,status,betting_ends_at,crash_multiplier,server_seed,seed_hash) VALUES(?,'countdown',?,?,?,?)",
          args: [id, now + BETTING_MS, makeCrashPoint(seed, id), seed, hash(seed)],
        });
      }
    }
    latest = await tx.execute({ sql: 'SELECT * FROM crash_rounds ORDER BY created_at DESC, rowid DESC LIMIT 1' });
    await tx.commit();
    return latest.rows[0];
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function GET(req: NextRequest) {
  const identity = verifiedPlayerFromRequest(req);
  if (!identity) return fail('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const round = await advanceRound(db);
    const roundId = String(round.id);
    const now = Date.now();
    const bets = await db.execute({
      sql: `SELECT b.telegram_id,b.username,b.amount,b.status,b.cashout_multiplier,b.payout,b.created_at,p.photo_url
            FROM crash_bets b LEFT JOIN players p ON p.telegram_id=b.telegram_id
            WHERE b.round_id=? ORDER BY b.created_at,b.telegram_id`,
      args: [roundId],
    });
    const [wallet, purchased, previous] = await Promise.all([
      db.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [String(identity.id)] }),
      db.execute({ sql: 'SELECT balance FROM bet_token_balances WHERE telegram_id=?', args: [String(identity.id)] }),
      db.execute({ sql: "SELECT id,status,crash_multiplier,crashed_at,seed_hash,server_seed FROM crash_rounds WHERE status='crashed' ORDER BY created_at DESC,rowid DESC LIMIT 1" }),
    ]);
    const status = String(round.status);
    const startedAt = round.started_at == null ? null : Number(round.started_at);
    const currentMultiplier = status === 'running' && startedAt !== null ? Math.min(Number(round.crash_multiplier), multiplierAt(startedAt, now)) : status === 'crashed' ? Number(round.crash_multiplier) : 1;
    const previousRound = previous.rows[0];
    let previousBets: Record<string, unknown>[] = [];
    if (previousRound && String(previousRound.id) !== roundId) {
      const result = await db.execute({
        sql: 'SELECT telegram_id,username,amount,status,cashout_multiplier,payout FROM crash_bets WHERE round_id=? ORDER BY created_at,telegram_id',
        args: [String(previousRound.id)],
      });
      previousBets = result.rows.map((row) => ({ telegramId: String(row.telegram_id), username: String(row.username), amount: Number(row.amount), status: String(row.status), cashoutMultiplier: row.cashout_multiplier == null ? null : Number(row.cashout_multiplier), payout: Number(row.payout) }));
    }
    return NextResponse.json({
      round: {
        id: roundId, status, bettingEndsAt: Number(round.betting_ends_at), startedAt,
        crashedAt: round.crashed_at == null ? null : Number(round.crashed_at),
        currentMultiplier, crashMultiplier: status === 'crashed' ? Number(round.crash_multiplier) : null,
        seedHash: String(round.seed_hash), revealedSeed: status === 'crashed' ? String(round.server_seed) : null,
      },
      bets: bets.rows.map((row) => ({
        telegramId: String(row.telegram_id), username: String(row.username || 'Player'),
        amount: Number(row.amount), status: String(row.status),
        cashoutMultiplier: row.cashout_multiplier == null ? null : Number(row.cashout_multiplier),
        payout: Number(row.payout), photoUrl: row.photo_url == null ? null : String(row.photo_url),
      })),
      balance: Number(wallet.rows[0]?.coins_balance ?? 0),
      betBalance: Number(purchased.rows[0]?.balance ?? 0),
      previousRound: previousRound ? {
        id: String(previousRound.id), crashMultiplier: Number(previousRound.crash_multiplier), crashedAt: Number(previousRound.crashed_at ?? now),
        seedHash: String(previousRound.seed_hash), revealedSeed: String(previousRound.server_seed), bets: previousBets,
      } : null,
      serverTime: now,
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('crash_state_failed', error);
    return fail('crash_unavailable', 503);
  }
}

export async function POST(req: NextRequest) {
  const identity = verifiedPlayerFromRequest(req);
  if (!identity) return fail('telegram_auth_required', 401);
  let body: { action?: unknown; amount?: unknown };
  try { body = await req.json(); } catch { return fail('invalid_body'); }
  if (body.action !== 'bet' && body.action !== 'cashout') return fail('invalid_action');
  if (body.action === 'bet' && (typeof body.amount !== 'number' || !Number.isSafeInteger(body.amount) || body.amount < MIN_BET)) return fail('minimum_100_required');
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const round = await advanceRound(db);
    const roundId = String(round.id);
    const playerId = String(identity.id);
    const tx = await db.transaction('write');
    try {
      const current = await tx.execute({ sql: 'SELECT * FROM crash_rounds WHERE id=?', args: [roundId] });
      if (!current.rows.length) throw new Error('round_not_found');
      const activeRound = current.rows[0];
      const now = Date.now();

      if (body.action === 'bet') {
        if (String(activeRound.status) !== 'countdown' || Number(activeRound.betting_ends_at) <= now) throw new Error('betting_closed');
        const player = await tx.execute({ sql: "SELECT telegram_id,COALESCE(username,first_name,'Player') AS username FROM players WHERE telegram_id=? AND status='active'", args: [playerId] });
        if (!player.rows.length) throw new Error('player_not_found');
        const existing = await tx.execute({ sql: 'SELECT id FROM crash_bets WHERE round_id=? AND telegram_id=?', args: [roundId, playerId] });
        if (existing.rows.length) throw new Error('already_joined');
        const betWallet = await tx.execute({ sql: 'INSERT INTO bet_token_balances(telegram_id,balance) VALUES(?,0) ON CONFLICT(telegram_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP RETURNING balance', args: [playerId] });
        const normal = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [playerId] });
        const betBalance = Number(betWallet.rows[0]?.balance ?? 0);
        const normalBalance = Number(normal.rows[0]?.coins_balance ?? 0);
        const amount = Number(body.amount);
        const purchasedAmount = betBalance >= amount ? amount : 0;
        const walletAmount = purchasedAmount === 0 && normalBalance >= amount ? amount : 0;
        if (!purchasedAmount && !walletAmount) throw new Error('insufficient_balance');
        if (purchasedAmount) {
          const debit = await tx.execute({ sql: 'UPDATE bet_token_balances SET balance=balance-?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND balance>=? RETURNING balance', args: [amount, playerId, amount] });
          if (!debit.rows.length) throw new Error('insufficient_balance');
          await tx.execute({ sql: "INSERT INTO bet_token_transactions(id,telegram_id,transaction_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'stake',?,?, 'crash_round',?,?,?)", args: [randomUUID(), playerId, -amount, Number(debit.rows[0].balance), roundId, `crash_bet:${roundId}:${playerId}`, JSON.stringify({ roundId })] });
        } else {
          const debit = await tx.execute({ sql: 'UPDATE player_wallets SET coins_balance=coins_balance-?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND coins_balance>=? RETURNING coins_balance', args: [amount, playerId, amount] });
          if (!debit.rows.length) throw new Error('insufficient_balance');
          await tx.execute({ sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','crash_bet',?,?, 'crash_round',?,?,?)", args: [randomUUID(), playerId, -amount, Number(debit.rows[0].coins_balance), roundId, `crash_bet:${roundId}:${playerId}`, JSON.stringify({ roundId })] });
        }
        await tx.execute({
          sql: "INSERT INTO crash_bets(id,round_id,telegram_id,username,amount,purchased_amount,wallet_amount,status) VALUES(?,?,?,?,?,?,?,'active')",
          args: [randomUUID(), roundId, playerId, String(player.rows[0].username || 'Player'), amount, purchasedAmount, walletAmount],
        });
        await tx.commit();
        return NextResponse.json({ ok: true, action: 'bet' }, { headers: { 'Cache-Control': 'no-store' } });
      }

      const bet = await tx.execute({ sql: "SELECT * FROM crash_bets WHERE round_id=? AND telegram_id=?", args: [roundId, playerId] });
      if (!bet.rows.length) throw new Error('bet_not_found');
      const wager = bet.rows[0];
      if (String(wager.status) === 'cashed_out') {
        await tx.commit();
        return NextResponse.json({ ok: true, action: 'cashout', payout: Number(wager.payout), multiplier: Number(wager.cashout_multiplier), alreadyProcessed: true });
      }
      if (String(wager.status) !== 'active' || String(activeRound.status) !== 'running') throw new Error('round_crashed');
      const startedAt = Number(activeRound.started_at);
      const multiplier = multiplierAt(startedAt, now);
      if (multiplier >= Number(activeRound.crash_multiplier)) {
        await tx.execute({ sql: "UPDATE crash_rounds SET status='crashed',crashed_at=? WHERE id=? AND status='running'", args: [now, roundId] });
        const burned = await tx.execute({ sql: "SELECT COALESCE(SUM(amount),0) AS total FROM crash_bets WHERE round_id=? AND status='active'", args: [roundId] });
          const burnedAmount = Number(burned.rows[0]?.total ?? 0);
          if (burnedAmount > 0) await tx.execute({ sql: 'UPDATE crash_house_pool SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE id=1', args: [burnedAmount] });
          await tx.execute({ sql: "UPDATE crash_bets SET status='lost',settled_at=CURRENT_TIMESTAMP WHERE round_id=? AND status='active'", args: [roundId] });
        const nextId = randomUUID();
        const nextSeed = randomBytes(32).toString('hex');
        await tx.execute({
          sql: "INSERT INTO crash_rounds(id,status,betting_ends_at,crash_multiplier,server_seed,seed_hash) VALUES(?,'countdown',?,?,?,?)",
          args: [nextId, now + BETTING_MS, makeCrashPoint(nextSeed, nextId), nextSeed, hash(nextSeed)],
        });
        await tx.commit();
        return fail('round_crashed');
      }
      const acceptedMultiplier = Math.max(1, Math.floor(multiplier * 100) / 100);
      const payout = crashPayout(Number(wager.amount), acceptedMultiplier);
      const marked = await tx.execute({
        sql: "UPDATE crash_bets SET status='cashed_out',cashout_multiplier=?,payout=?,settled_at=CURRENT_TIMESTAMP WHERE id=? AND status='active' RETURNING id",
        args: [acceptedMultiplier, payout, String(wager.id)],
      });
      if (!marked.rows.length) throw new Error('cashout_already_processed');
      const before = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [playerId] });
      if (!before.rows.length) throw new Error('player_not_found');
      const afterBalance = Number(before.rows[0].coins_balance) + payout;
      await tx.execute({
        sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','crash_payout',?,?, 'crash_round',?,?,?)",
        args: [randomUUID(), playerId, payout, afterBalance, roundId, `crash_payout:${roundId}:${playerId}`, JSON.stringify({ roundId, stake: Number(wager.amount), multiplier: acceptedMultiplier })],
      });
      await tx.execute({ sql: 'UPDATE player_wallets SET coins_balance=coins_balance+?,lifetime_coins_earned=lifetime_coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?', args: [payout, payout, playerId] });
      await tx.execute({ sql: "INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,'crash_payout',?,?,?)", args: [randomUUID(), playerId, payout, JSON.stringify({ roundId, multiplier: acceptedMultiplier }), `event:crash_payout:${roundId}:${playerId}`] });
      await tx.commit();
      return NextResponse.json({ ok: true, action: 'cashout', payout, multiplier: acceptedMultiplier }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await tx.rollback();
      const message = String((error as { message?: string })?.message ?? '');
      const known = ['round_not_found','betting_closed','player_not_found','already_joined','insufficient_balance','bet_not_found','round_crashed','cashout_already_processed'];
      if (known.includes(message)) return fail(message);
      throw error;
    }
  } catch (error) {
    console.error('crash_action_failed', error);
    return fail('crash_action_failed', 503);
  }
}
