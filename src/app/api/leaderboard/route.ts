import { NextRequest, NextResponse } from 'next/server';
import { ensurePlayerSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const identity = verifiedPlayerFromRequest(req);
  if (!identity) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });
  try {
    await ensurePlayerSchema();
    const month = new URL(req.url).searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'invalid_month' }, { status: 400 });
    const result = await getTurso().execute({
      sql: `SELECT p.telegram_id AS player_id,
                   COALESCE(NULLIF(p.username, ''), NULLIF(TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''), 'Player') AS player_name,
                   s.coins_earned, s.taps, s.sells
            FROM player_monthly_stats s
            RIGHT JOIN players p ON p.telegram_id = s.telegram_id
            WHERE s.month_key = ?
            ORDER BY COALESCE(s.coins_earned, 0) DESC, COALESCE(s.updated_at, p.created_at) ASC
            LIMIT 100`,
      args: [month],
    });
    const entries = result.rows.map((row, index) => ({
      rank: index + 1,
      playerId: String(row.player_id),
      name: String(row.player_name),
      coinsEarned: Number(row.coins_earned ?? 0),
      taps: Number(row.taps ?? 0),
      sells: Number(row.sells ?? 0),
      isUser: String(row.player_id) === String(identity.id),
    }));
    return NextResponse.json({ month, entries, totalPlayers: entries.length, source: 'turso' }, {
      headers: { 'Cache-Control': 'no-store, private' },
    });
  } catch (error) {
    console.error('leaderboard_failed', error);
    return NextResponse.json({ error: 'leaderboard_unavailable' }, { status: 503 });
  }
}
