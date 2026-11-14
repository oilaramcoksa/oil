import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!verifiedPlayerFromRequest(req)) {
    return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const roundsResult = await db.execute({
      sql: `SELECT id, status, winner_type, winner_telegram_id, total_entries,
        strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(completed_at, created_at)) AS occurred_at
        FROM arena_rounds
        WHERE status IN ('completed', 'cancelled')
        ORDER BY COALESCE(completed_at, created_at) DESC, id DESC
        LIMIT 40`,
    });

    const rounds = [];
    for (const row of roundsResult.rows) {
      const roundId = String(row.id);
      const entriesResult = await db.execute({
        sql: `SELECT e.telegram_id, e.amount, p.username, p.first_name
          FROM arena_entries e
          JOIN players p ON p.telegram_id = e.telegram_id
          WHERE e.round_id = ?
          ORDER BY e.created_at ASC, e.telegram_id ASC`,
        args: [roundId],
      });
      const winnerId = row.winner_telegram_id == null ? null : String(row.winner_telegram_id);
      const total = Number(row.total_entries ?? 0);
      const cancelled = String(row.status) === 'cancelled';
      const entries = entriesResult.rows.map((entry) => {
        const telegramId = String(entry.telegram_id);
        const stake = Number(entry.amount);
        const won = !cancelled && String(row.winner_type) === 'player' && winnerId === telegramId;
        const refunded = cancelled;
        const payout = won ? total : refunded ? stake : 0;
        return {
          telegramId,
          username: String(entry.username || entry.first_name || 'Player'),
          stake,
          outcome: won ? 'win' : refunded ? 'refund' : 'loss',
          amount: won ? payout : stake,
          multiplier: won && stake > 0 ? payout / stake : 1,
        };
      });
      rounds.push({
        id: roundId,
        status: String(row.status),
        occurredAt: String(row.occurred_at),
        total,
        winnerTelegramId: winnerId,
        winnerType: row.winner_type == null ? null : String(row.winner_type),
        entries,
      });
    }

    return NextResponse.json({ rounds }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('arena_history_failed', error);
    return NextResponse.json({ error: 'arena_history_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
