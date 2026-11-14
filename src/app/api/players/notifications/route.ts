import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const identity = verifiedPlayerFromRequest(req);
  if (!identity) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const player = await db.execute({
      sql: "SELECT status FROM players WHERE telegram_id=?",
      args: [String(identity.id)],
    });
    if (!player.rows.length || String(player.rows[0].status) !== 'active') {
      return NextResponse.json({ error: 'player_suspended' }, { status: 403 });
    }
    const rows = await db.execute({
      sql: "SELECT id,event_type,amount,metadata_json,created_at FROM player_events WHERE telegram_id=? AND event_type='admin_notification' ORDER BY created_at DESC LIMIT 30",
      args: [String(identity.id)],
    });
    return NextResponse.json({
      notifications: rows.rows.map((row) => {
        let meta: Record<string, unknown> = {};
        try {
          const value = JSON.parse(String(row.metadata_json ?? '{}'));
          if (value && typeof value === 'object' && !Array.isArray(value)) meta = value as Record<string, unknown>;
        } catch { /* Skip malformed metadata. */ }
        return {
          id: String(row.id),
          type: String(row.event_type),
          amount: Number(row.amount ?? 0),
          createdAt: String(row.created_at ?? ''),
          title: typeof meta.title === 'string' ? meta.title : 'إشعار من إدارة اللعبة',
          message: typeof meta.message === 'string' ? meta.message : '',
          kind: typeof meta.kind === 'string' ? meta.kind : 'info',
        };
      }),
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('player_notifications_failed', error);
    return NextResponse.json({ error: 'notifications_unavailable' }, { status: 503 });
  }
}
