import { NextRequest, NextResponse } from 'next/server';
import { getTurso } from '@/lib/turso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MONETAG_ZONE_ID = '12295910';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const secret = process.env.MONETAG_POSTBACK_SECRET;
  if (!secret || params.get('secret') !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ymid = params.get('ymid') ?? '';
  const zoneId = params.get('zone_id') ?? '';
  const eventType = params.get('event_type') ?? '';
  const rewardEventType = params.get('reward_event_type') ?? '';
  const telegramId = params.get('telegram_id') ?? '';
  const validYmid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ymid);
  if (!validYmid || !/^[0-9]+$/.test(telegramId) || zoneId !== MONETAG_ZONE_ID || eventType !== 'impression') {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const db = getTurso();
    await db.execute(`CREATE TABLE IF NOT EXISTS monetag_ad_postbacks (
      ymid TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, zone_id TEXT NOT NULL,
      event_type TEXT NOT NULL, reward_event_type TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, consumed_at TEXT
    )`);
    await db.execute({
      sql: 'INSERT OR IGNORE INTO monetag_ad_postbacks(ymid,telegram_id,zone_id,event_type,reward_event_type) VALUES(?,?,?,?,?)',
      args: [ymid, telegramId, zoneId, eventType, rewardEventType],
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('monetag_postback_failed', error);
    return NextResponse.json({ error: 'postback_unavailable' }, { status: 503 });
  }
}
