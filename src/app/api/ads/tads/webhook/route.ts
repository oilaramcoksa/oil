import { randomUUID, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_WIDGETS = new Set(['13283', '13284']);

function authorized(req: NextRequest) {
  const expected = process.env.TADS_WEBHOOK_SECRET;
  const received = req.nextUrl.searchParams.get('token') ?? '';
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as { telegram_id?: unknown; widget_id?: unknown };
    const telegramId = typeof body.telegram_id === 'string' ? body.telegram_id.trim() : '';
    const widgetId = String(body.widget_id ?? '');
    if (!/^\d{5,20}$/.test(telegramId) || !ALLOWED_WIDGETS.has(widgetId)) {
      return NextResponse.json({ error: 'invalid_event' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    const db = getTurso();
    await db.execute(`CREATE TABLE IF NOT EXISTS tads_ad_webhook_events (
      id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL,
      widget_id TEXT NOT NULL CHECK(widget_id IN ('13283','13284')),
      event_type TEXT NOT NULL CHECK(event_type IN ('view','click')),
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, consumed_at TEXT
    )`);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_tads_ad_events_claim ON tads_ad_webhook_events(telegram_id,widget_id,consumed_at,received_at)');
    const player = await db.execute({ sql: 'SELECT telegram_id FROM players WHERE telegram_id=?', args: [telegramId] });
    if (!player.rows.length) return NextResponse.json({ ok: true, ignored: true }, { headers: { 'Cache-Control': 'no-store' } });
    const eventType = widgetId === '13283' ? 'view' : 'click';
    await db.execute({
      sql: 'INSERT INTO tads_ad_webhook_events(id,telegram_id,widget_id,event_type) VALUES(?,?,?,?)',
      args: [randomUUID(), telegramId, widgetId, eventType],
    });
    await db.execute("DELETE FROM tads_ad_webhook_events WHERE received_at < datetime('now','-2 days')");
    return NextResponse.json({ ok: true, event: eventType }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('tads_webhook_receive_failed', error);
    return NextResponse.json({ error: 'webhook_unavailable' }, { status: 503 });
  }
}
