import { NextRequest, NextResponse } from 'next/server';
import { randomInt, randomUUID } from 'node:crypto';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';
import { broadcastGameInvite } from '@/lib/game-invite-notice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BETTING_MS = 15_000;
const SPIN_MS = 7_000;
const MIN_BET = 100;
const COLORS = ['yellow', 'purple', 'yellow', 'purple', 'yellow', 'purple', 'yellow', 'turquoise', 'purple', 'yellow', 'purple', 'yellow', 'purple', 'yellow', 'purple'] as const;
const MULTIPLIERS = { yellow: 1.95, purple: 1.95, turquoise: 9.5 } as const;
type Color = keyof typeof MULTIPLIERS;

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}
function colorAt(index: number): Color { return COLORS[index] ?? 'yellow'; }

async function ensureColorTables(db: ReturnType<typeof getTurso>) {
  await db.execute(`CREATE TABLE IF NOT EXISTS color_wheel_rounds (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','spinning','completed')),
    starts_at INTEGER,
    spin_started_at INTEGER,
    winning_sector INTEGER,
    winning_color TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS color_wheel_bets (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES color_wheel_rounds(id),
    telegram_id TEXT NOT NULL REFERENCES players(telegram_id),
    color TEXT NOT NULL CHECK(color IN ('yellow','purple','turquoise')),
    amount INTEGER NOT NULL CHECK(amount >= 100),
    payout INTEGER NOT NULL DEFAULT 0,
    outcome TEXT NOT NULL DEFAULT 'pending' CHECK(outcome IN ('pending','win','loss')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(round_id, telegram_id)
  )`);
  await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_color_wheel_one_active ON color_wheel_rounds((1)) WHERE status IN ('open','spinning')");
  await db.execute('CREATE INDEX IF NOT EXISTS idx_color_wheel_history ON color_wheel_rounds(status, completed_at DESC)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_color_wheel_bets_round ON color_wheel_bets(round_id, created_at)');
}

async function createRound(db: ReturnType<typeof getTurso>) {
  try {
    await db.execute({ sql: "INSERT INTO color_wheel_rounds(id,status) VALUES(?,'open')", args: [randomUUID()] });
  } catch {
    // Another concurrent request may have created the active round first.
  }
}

async function advanceRound(db: ReturnType<typeof getTurso>) {
  let active = await db.execute("SELECT * FROM color_wheel_rounds WHERE status IN ('open','spinning') ORDER BY created_at DESC LIMIT 1");
  if (!active.rows.length) {
    await createRound(db);
    active = await db.execute("SELECT * FROM color_wheel_rounds WHERE status IN ('open','spinning') ORDER BY created_at DESC LIMIT 1");
  }
  let round = active.rows[0];
  if (!round) throw new Error('color_wheel_round_unavailable');

  const now = Date.now();
  if (String(round.status) === 'open' && round.starts_at != null && Number(round.starts_at) <= now) {
    const sector = randomInt(0, 15);
    await db.execute({
      sql: "UPDATE color_wheel_rounds SET status='spinning',spin_started_at=?,winning_sector=?,winning_color=? WHERE id=? AND status='open' AND starts_at<=?",
      args: [now, sector, colorAt(sector), String(round.id), now],
    });
    active = await db.execute("SELECT * FROM color_wheel_rounds WHERE status IN ('open','spinning') ORDER BY created_at DESC LIMIT 1");
    round = active.rows[0] ?? round;
  }

  if (String(round.status) === 'spinning' && round.spin_started_at != null && Number(round.spin_started_at) + SPIN_MS <= now) {
    const tx = await db.transaction('write');
    try {
      const current = await tx.execute({
        sql: "SELECT id,winning_color FROM color_wheel_rounds WHERE id=? AND status='spinning' AND spin_started_at<=?",
        args: [String(round.id), now - SPIN_MS],
      });
      if (current.rows.length) {
        const winningColor = String(current.rows[0].winning_color) as Color;
        const bets = await tx.execute({
          sql: 'SELECT id,telegram_id,color,amount FROM color_wheel_bets WHERE round_id=? AND outcome=\'pending\' ORDER BY created_at,telegram_id',
          args: [String(round.id)],
        });
        for (const bet of bets.rows) {
          const won = String(bet.color) === winningColor;
          const payout = won ? Math.floor(Number(bet.amount) * MULTIPLIERS[winningColor]) : 0;
          if (payout > 0) {
            const credited = await tx.execute({
              sql: 'UPDATE player_wallets SET coins_balance=coins_balance+?,lifetime_coins_earned=lifetime_coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? RETURNING coins_balance',
              args: [payout, payout, String(bet.telegram_id)],
            });
            if (!credited.rows.length) throw new Error('color_wheel_player_wallet_missing');
            await tx.execute({
              sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','color_wheel_prize',?,?,'color_wheel_round',?,?,?)",
              args: [randomUUID(), String(bet.telegram_id), payout, Number(credited.rows[0].coins_balance), String(round.id), `color_wheel_prize:${round.id}:${String(bet.telegram_id)}`, JSON.stringify({ color: winningColor, stake: Number(bet.amount), multiplier: MULTIPLIERS[winningColor] })],
            });
            await tx.execute({
              sql: "INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,'color_wheel_prize',?,?,?)",
              args: [randomUUID(), String(bet.telegram_id), payout, JSON.stringify({ roundId: String(round.id), color: winningColor }), `event:color_wheel_prize:${round.id}:${String(bet.telegram_id)}`],
            });
          }
          await tx.execute({
            sql: "UPDATE color_wheel_bets SET outcome=?,payout=? WHERE id=? AND outcome='pending'",
            args: [won ? 'win' : 'loss', payout, String(bet.id)],
          });
        }
        await tx.execute({
          sql: "UPDATE color_wheel_rounds SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id=? AND status='spinning'",
          args: [String(round.id)],
        });
      }
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
    await createRound(db);
    active = await db.execute("SELECT * FROM color_wheel_rounds WHERE status IN ('open','spinning') ORDER BY created_at DESC LIMIT 1");
    round = active.rows[0] ?? round;
  }
  return round;
}

export async function GET(req: NextRequest) {
  const identity = verifiedPlayerFromRequest(req);
  if (!identity) return jsonError('telegram_auth_required', 401);
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    await ensureColorTables(db);
    const playerId = String(identity.id);
    await db.execute({
      sql: 'UPDATE players SET username=COALESCE(?,username),first_name=COALESCE(?,first_name),last_name=COALESCE(?,last_name),photo_url=COALESCE(?,photo_url) WHERE telegram_id=?',
      args: [identity.username ?? null, identity.first_name ?? null, identity.last_name ?? null, identity.photo_url ?? null, playerId],
    });
    const round = await advanceRound(db);
    const roundId = String(round.id);
    const [wallet, betsResult, historyResult, winnersResult] = await Promise.all([
      db.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [playerId] }),
      db.execute({
        sql: `SELECT b.telegram_id,b.color,b.amount,b.payout,b.outcome,p.username,p.first_name,p.photo_url
          FROM color_wheel_bets b JOIN players p ON p.telegram_id=b.telegram_id
          WHERE b.round_id=? ORDER BY b.created_at,b.telegram_id`,
        args: [roundId],
      }),
      db.execute(`SELECT id,winning_color,winning_sector,completed_at,
          (SELECT COUNT(*) FROM color_wheel_bets b WHERE b.round_id=r.id) AS bets_count,
          (SELECT COALESCE(SUM(amount),0) FROM color_wheel_bets b WHERE b.round_id=r.id) AS total_amount
        FROM color_wheel_rounds r WHERE status='completed'
        ORDER BY completed_at DESC LIMIT 12`),
      db.execute(`SELECT b.telegram_id,b.payout,b.color,r.id AS round_id,r.completed_at,p.username,p.first_name,p.photo_url
        FROM color_wheel_bets b
        JOIN color_wheel_rounds r ON r.id=b.round_id
        JOIN players p ON p.telegram_id=b.telegram_id
        WHERE b.outcome='win' AND r.status='completed'
        ORDER BY r.completed_at DESC,b.payout DESC LIMIT 2`),
    ]);
    const bets = betsResult.rows.map((row) => ({
      telegramId: String(row.telegram_id),
      username: String(row.username || row.first_name || 'Player'),
      photoUrl: row.photo_url == null ? null : String(row.photo_url),
      color: String(row.color),
      amount: Number(row.amount),
      payout: Number(row.payout ?? 0),
      outcome: String(row.outcome),
    }));
    const ownBet = bets.find((bet) => bet.telegramId === playerId) ?? null;
    const winners = winnersResult.rows.map((row) => ({
      telegramId: String(row.telegram_id),
      username: String(row.username || row.first_name || 'Player'),
      photoUrl: row.photo_url == null ? null : String(row.photo_url),
      payout: Number(row.payout),
      color: String(row.color),
      roundId: String(row.round_id),
    }));
    const history = historyResult.rows.map((row) => ({
      id: String(row.id),
      color: String(row.winning_color),
      sector: Number(row.winning_sector),
      betsCount: Number(row.bets_count ?? 0),
      total: Number(row.total_amount ?? 0),
      completedAt: String(row.completed_at ?? ''),
    }));
    return NextResponse.json({
      round: {
        id: roundId,
        status: String(round.status),
        startsAt: round.starts_at == null ? null : Number(round.starts_at),
        spinStartedAt: round.spin_started_at == null ? null : Number(round.spin_started_at),
        winningSector: round.winning_sector == null ? null : Number(round.winning_sector),
        winningColor: round.winning_color == null ? null : String(round.winning_color),
      },
      balance: Number(wallet.rows[0]?.coins_balance ?? 0),
      bets,
      ownBet,
      winners,
      history,
      serverNow: Date.now(),
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('color_wheel_state_failed', error);
    return jsonError('color_wheel_unavailable', 503);
  }
}

export async function POST(req: NextRequest) {
  const identity = verifiedPlayerFromRequest(req);
  if (!identity) return jsonError('telegram_auth_required', 401);
  let body: { amount?: unknown; color?: unknown };
  try { body = await req.json(); } catch { return jsonError('invalid_body'); }
  if (!Number.isSafeInteger(body.amount) || Number(body.amount) < MIN_BET) return jsonError('minimum_100_required');
  if (body.color !== 'yellow' && body.color !== 'purple' && body.color !== 'turquoise') return jsonError('invalid_color');
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    await ensureColorTables(db);
    await advanceRound(db);
    const playerId = String(identity.id);
    const roundResult = await db.execute("SELECT id,status,starts_at FROM color_wheel_rounds WHERE status='open' ORDER BY created_at DESC LIMIT 1");
    const active = roundResult.rows[0];
    if (!active || (active.starts_at != null && Number(active.starts_at) <= Date.now())) return jsonError('betting_closed', 409);
    const roundId = String(active.id);
    const tx = await db.transaction('write');
    let newBalance = 0;
    let playerName = 'لاعب';
    let firstBet = false;
    try {
      const lockedRound = await tx.execute({ sql: "SELECT status,starts_at FROM color_wheel_rounds WHERE id=?", args: [roundId] });
      if (!lockedRound.rows.length || String(lockedRound.rows[0].status) !== 'open' || (lockedRound.rows[0].starts_at != null && Number(lockedRound.rows[0].starts_at) <= Date.now())) throw new Error('betting_closed');
      const profile = await tx.execute({ sql: "SELECT COALESCE(username,first_name,'لاعب') AS display_name FROM players WHERE telegram_id=? AND status='active'", args: [playerId] });
      if (!profile.rows.length) throw new Error('player_not_found');
      playerName = String(profile.rows[0].display_name);
      const existing = await tx.execute({ sql: 'SELECT id FROM color_wheel_bets WHERE round_id=? AND telegram_id=?', args: [roundId, playerId] });
      if (existing.rows.length) throw new Error('already_bet');
      const debit = await tx.execute({
        sql: 'UPDATE player_wallets SET coins_balance=coins_balance-?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND coins_balance>=? RETURNING coins_balance',
        args: [Number(body.amount), playerId, Number(body.amount)],
      });
      if (!debit.rows.length) throw new Error('insufficient_balance');
      newBalance = Number(debit.rows[0].coins_balance);
      await tx.execute({
        sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','color_wheel_bet',?,?,'color_wheel_round',?,?,?)",
        args: [randomUUID(), playerId, -Number(body.amount), newBalance, roundId, `color_wheel_bet:${roundId}:${playerId}`, JSON.stringify({ color: body.color })],
      });
      await tx.execute({
        sql: "INSERT INTO color_wheel_bets(id,round_id,telegram_id,color,amount) VALUES(?,?,?,?,?)",
        args: [randomUUID(), roundId, playerId, body.color, Number(body.amount)],
      });
      await tx.execute({
        sql: "INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,'color_wheel_bet',?,?,?)",
        args: [randomUUID(), playerId, -Number(body.amount), JSON.stringify({ roundId, color: body.color }), `event:color_wheel_bet:${roundId}:${playerId}`],
      });
      const count = await tx.execute({ sql: 'SELECT COUNT(*) AS count FROM color_wheel_bets WHERE round_id=?', args: [roundId] });
      firstBet = Number(count.rows[0]?.count ?? 0) === 1;
      if (firstBet) {
        await tx.execute({
          sql: "UPDATE color_wheel_rounds SET starts_at=? WHERE id=? AND status='open' AND starts_at IS NULL",
          args: [Date.now() + BETTING_MS, roundId],
        });
      }
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
    if (firstBet) await broadcastGameInvite(db, { game: 'colors', roundId, playerId, playerName });
    return NextResponse.json({ ok: true, balance: newBalance, roundId }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'insufficient_balance') return jsonError('insufficient_balance', 409);
    if (code === 'already_bet') return jsonError('already_bet', 409);
    if (code === 'betting_closed') return jsonError('betting_closed', 409);
    if (code === 'player_not_found') return jsonError('player_not_found', 404);
    console.error('color_wheel_bet_failed', error);
    return jsonError('color_wheel_bet_failed', 503);
  }
}
