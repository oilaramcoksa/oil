import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_KEYS = [
  'upgrades', 'tasks', 'referrals', 'transactions',
  'tonAddress', 'withdrawals', 'refundedWithdrawals',
  'tapsToday', 'sellsToday', 'qualifiedSellsToday', 'tapsThisWeek',
  'sellsThisWeek', 'tapsTotal', 'sellsTotal', 'coinsEarnedThisMonth',
  'lastMonthKey', 'lastLoginDay', 'loginStreak', 'luckyBoxLastOpened',
  'totalStoreRevenue', 'tournamentHistory', 'claimedAchievements',
  'lang', 'onboarded', 'acceptedDisclaimer', 'sound', 'vibration',
] as const;

function cleanState(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const state: Record<string, unknown> = {};
  for (const key of STATE_KEYS) {
    if (key in source) state[key] = source[key];
  }
  for (const key of ['tapsToday', 'sellsToday', 'tapsTotal', 'sellsTotal', 'coinsEarnedThisMonth']) {
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
    const player = await db.execute({ sql: 'SELECT status FROM players WHERE telegram_id = ?', args: [id] });
    if (!player.rows.length || String(player.rows[0].status) !== 'active') {
      return NextResponse.json({ error: 'player_suspended' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    const [result, wallet, ledger, gameSettings, miningCycle] = await Promise.all([
      db.execute({
        sql: 'SELECT state_json, revision, updated_at FROM player_game_snapshots WHERE telegram_id = ?',
        args: [id],
      }),
      db.execute({
        sql: 'SELECT oil_balance, coins_balance, coins_locked FROM player_wallets WHERE telegram_id = ?',
        args: [id],
      }),
      db.execute({
        sql: `SELECT id, asset, entry_type, amount, created_at, metadata_json
              FROM ledger_entries WHERE telegram_id = ?
              ORDER BY created_at DESC LIMIT 50`,
        args: [id],
      }),
      db.execute({
        sql: 'SELECT base_oil_per_tap, base_capacity FROM player_game_state WHERE telegram_id = ?',
        args: [id],
      }),
      db.execute({ sql: 'SELECT cycle_ends_at FROM player_game_state WHERE telegram_id = ?', args: [id] }),
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
    state = { ...(state ?? {}), ...(walletState ?? { oil: 0, coins: 0 }) };
    const authoritativeCycleEnd = Number(miningCycle.rows[0]?.cycle_ends_at ?? 0) || null;
    state = { ...(state ?? {}), cycleEndsAt: authoritativeCycleEnd };

    return NextResponse.json({
      exists: !!row,
      revision: Number(row?.revision ?? 0),
      updatedAt: row?.updated_at?.toString() ?? null,
      state,
      wallet: w ? { ...walletState, locked: Number(w.coins_locked) } : null,
      gameSettings: gameSettings.rows[0] ? { baseOilPerTap: Number(gameSettings.rows[0].base_oil_per_tap), baseCapacity: Number(gameSettings.rows[0].base_capacity) } : null,
      ledgerTransactions: ledger.rows.map((entry) => {
        const entryType = String(entry.entry_type);
        const labelByType: Record<string, string> = {
          arena_entry: 'txArenaEntry',
          arena_prize: 'txArenaPrize',
          arena_refund: 'txArenaRefund',
          tads_ad_reward: 'txAdReward',
          sell: 'txSell',
          withdraw: 'txWithdraw',
          refund: 'txRefund',
        };
        const createdAt = Date.parse(String(entry.created_at ?? '')) || Date.now();
        let meta: Record<string, string | number> = {};
        try {
          const parsed = entry.metadata_json ? JSON.parse(String(entry.metadata_json)) : {};
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed;
        } catch { /* Keep malformed legacy metadata empty. */ }
        return {
          id: String(entry.id),
          type: entryType.startsWith('arena_') ? 'arena' : entryType === 'tads_ad_reward' ? 'ad' : 'sell',
          amount: Number(entry.amount),
          label: labelByType[entryType] ?? 'txLedger',
          createdAt,
          meta: { ...meta, asset: String(entry.asset), entryType },
        };
      }),
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
    const player = await db.execute({ sql: 'SELECT status FROM players WHERE telegram_id = ?', args: [id] });
    if (!player.rows.length || String(player.rows[0].status) !== 'active') {
      return NextResponse.json({ error: 'player_suspended' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    // Financial values and mining-cycle timestamps are never accepted from the browser.
    // Keep only non-financial game preferences/progress in the JSON snapshot.
    delete state.oil;
    delete state.coins;
    delete state.cycleEndsAt;
    delete state.lastTickAt;

    await db.execute({
      sql: `INSERT INTO player_game_snapshots (telegram_id, state_json, revision, updated_at)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(telegram_id) DO UPDATE SET
              state_json = excluded.state_json,
              revision = player_game_snapshots.revision + 1,
              updated_at = CURRENT_TIMESTAMP`,
      args: [id, JSON.stringify(state)],
    });
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
