import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_KEYS = [
  'oil', 'coins', 'upgrades', 'tasks', 'referrals', 'transactions',
  'tonAddress', 'withdrawals', 'refundedWithdrawals',
  'tapsToday', 'sellsToday', 'qualifiedSellsToday', 'tapsThisWeek',
  'sellsThisWeek', 'tapsTotal', 'sellsTotal', 'coinsEarnedThisMonth',
  'lastMonthKey', 'lastLoginDay', 'loginStreak', 'luckyBoxLastOpened',
  'totalStoreRevenue', 'tournamentHistory', 'claimedAchievements',
  'cycleEndsAt', 'lastTickAt', 'lang', 'onboarded', 'acceptedDisclaimer', 'sound', 'vibration',
] as const;

function cleanState(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const state: Record<string, unknown> = {};
  for (const key of STATE_KEYS) {
    if (key in source) state[key] = source[key];
  }
  for (const key of ['oil', 'coins', 'tapsToday', 'sellsToday', 'tapsTotal', 'sellsTotal', 'coinsEarnedThisMonth']) {
    const value = state[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000_000_000)) return null;
  }
  if (JSON.stringify(state).length > 180_000) return null;
  return state;
}

export async function GET(req: NextRequest) {
  const identity = verifiedPlayerFromRequest(req);
  if (!identity) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const id = String(identity.id);
    const [result, wallet] = await Promise.all([
      db.execute({
        sql: 'SELECT state_json, revision, updated_at FROM player_game_snapshots WHERE telegram_id = ?',
        args: [id],
      }),
      db.execute({
        sql: 'SELECT oil_balance, coins_balance, coins_locked FROM player_wallets WHERE telegram_id = ?',
        args: [id],
      }),
    ]);
    const row = result.rows[0];
    const w = wallet.rows[0];
    const walletState = w ? {
      oil: Number(w.oil_balance),
      coins: Number(w.coins_balance),
    } : null;
    let state: Record<string, unknown> | null = row
      ? JSON.parse(String(row.state_json)) as Record<string, unknown>
      : null;

    // The relational wallet is authoritative. A stale JSON snapshot must never
    // replace a ledger-backed balance with zero or an older client-side value.
    if (state && walletState) state = { ...state, ...walletState };

    return NextResponse.json({
      exists: !!row,
      revision: Number(row?.revision ?? 0),
      updatedAt: row?.updated_at?.toString() ?? null,
      state,
      wallet: w ? { ...walletState, locked: Number(w.coins_locked) } : null,
      source: 'turso',
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('game_state_read_failed', error);
    return NextResponse.json({ error: 'game_state_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function PUT(req: NextRequest) {
  const identity = verifiedPlayerFromRequest(req);
  if (!identity) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });
  let body: { state?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
  const state = cleanState(body.state);
  if (!state) return NextResponse.json({ error: 'invalid_game_state' }, { status: 400 });
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const id = String(identity.id);
    const wallet = await db.execute({
      sql: 'SELECT coins_balance, oil_balance FROM player_wallets WHERE telegram_id = ?',
      args: [id],
    });
    const current = wallet.rows[0];
    const [coinLedger, oilLedger] = await Promise.all([
      db.execute({ sql: "SELECT 1 AS found FROM ledger_entries WHERE telegram_id = ? AND asset = 'coins' LIMIT 1", args: [id] }),
      db.execute({ sql: "SELECT 1 AS found FROM ledger_entries WHERE telegram_id = ? AND asset = 'oil' LIMIT 1", args: [id] }),
    ]);
    // Coins become ledger-authoritative as soon as a financial coin operation
    // exists. Oil remains snapshot-synced until it has its own ledger history.
    const coins = Math.floor(Number(state.coins ?? 0));
    const oil = Math.floor(Number(state.oil ?? 0));
    const oldCoins = Number(current?.coins_balance ?? 0);
    const oldOil = Number(current?.oil_balance ?? 0);
    if (coinLedger.rows.length) state.coins = oldCoins;
    if (oilLedger.rows.length) state.oil = oldOil;
    await db.batch([
      {
        sql: `INSERT INTO player_game_snapshots (telegram_id, state_json, revision, updated_at)
              VALUES (?, ?, 1, CURRENT_TIMESTAMP)
              ON CONFLICT(telegram_id) DO UPDATE SET
                state_json = excluded.state_json,
                revision = player_game_snapshots.revision + 1,
                updated_at = CURRENT_TIMESTAMP`,
        args: [id, JSON.stringify(state)],
      },
      {
        sql: `UPDATE player_wallets SET
                coins_balance = CASE WHEN NOT EXISTS (
                  SELECT 1 FROM ledger_entries WHERE telegram_id = ? AND asset = 'coins'
                ) THEN ? ELSE coins_balance END,
                oil_balance = CASE WHEN NOT EXISTS (
                  SELECT 1 FROM ledger_entries WHERE telegram_id = ? AND asset = 'oil'
                ) THEN ? ELSE oil_balance END,
                updated_at = CURRENT_TIMESTAMP
              WHERE telegram_id = ?`,
        args: [id, coins, id, oil, id],
      },
    ], 'write');
    const revision = await db.execute({
      sql: 'SELECT revision FROM player_game_snapshots WHERE telegram_id = ?',
      args: [id],
    });
    return NextResponse.json({ ok: true, revision: Number(revision.rows[0]?.revision ?? 1), source: 'turso' }, {
      headers: { 'Cache-Control': 'no-store, private' },
    });
  } catch (error) {
    console.error('game_state_write_failed', error);
    return NextResponse.json({ error: 'game_state_save_failed' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
