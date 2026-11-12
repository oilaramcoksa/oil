import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: NextRequest): boolean | 'unconfigured' {
  const token = process.env.ADMIN_TOKEN;
  if (!token || token.length < 32) return 'unconfigured';
  return req.headers.get('authorization') === `Bearer ${token}`;
}

export async function GET(req: NextRequest) {
  const ok = authorized(req);
  if (ok === 'unconfigured') return NextResponse.json({ error: 'admin_disabled' }, { status: 503 });
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const month = new Date().toISOString().slice(0, 7);
    const [players, activePlayers, wallets, referrals, payments, withdrawals, ledger, monthly] = await Promise.all([
      db.execute('SELECT COUNT(*) AS total FROM players'),
      db.execute("SELECT COUNT(*) AS total FROM players WHERE status = 'active' AND last_seen_at >= datetime('now', '-7 days')"),
      db.execute('SELECT COALESCE(SUM(coins_balance),0) AS coins, COALESCE(SUM(oil_balance),0) AS oil, COALESCE(SUM(coins_locked),0) AS locked FROM player_wallets'),
      db.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'rewarded' THEN 1 ELSE 0 END) AS rewarded FROM referrals"),
      db.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed FROM payment_transactions"),
      db.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending FROM withdrawal_requests"),
      db.execute('SELECT COUNT(*) AS total FROM ledger_entries'),
      db.execute({ sql: 'SELECT COUNT(*) AS players, COALESCE(SUM(coins_earned),0) AS coins_earned, COALESCE(SUM(taps),0) AS taps, COALESCE(SUM(sells),0) AS sells FROM player_monthly_stats WHERE month_key = ?', args: [month] }),
    ]);
    const one = (r: typeof players): Record<string, unknown> => (r.rows[0] ?? {}) as Record<string, unknown>;
    const num = (v: unknown) => Number(v ?? 0);
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      source: 'turso',
      players: { total: num(one(players).total), activeLast7Days: num(one(activePlayers).total) },
      wallets: { coinsInCirculation: num(one(wallets).coins), oilInStorage: num(one(wallets).oil), coinsLocked: num(one(wallets).locked) },
      referrals: { total: num(one(referrals).total), rewarded: num(one(referrals).rewarded) },
      payments: { total: num(one(payments).total), confirmed: num(one(payments).confirmed) },
      withdrawals: { total: num(one(withdrawals).total), pending: num(one(withdrawals).pending) },
      ledger: { entries: num(one(ledger).total) },
      currentMonth: { month, players: num(one(monthly).players), coinsEarned: num(one(monthly).coins_earned), taps: num(one(monthly).taps), sells: num(one(monthly).sells) },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('database_overview_failed', error);
    return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
  }
}
