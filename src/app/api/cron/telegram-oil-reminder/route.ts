import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CAIRO_TIME_ZONE = 'Africa/Cairo';
const MESSAGE = [
  '<b>💰 ثروتك تنتظرك!</b>',
  '',
  'هيا بنا نبيع البترول الخاص بك ونحوّل مجهودك إلى مكافآت داخل اللعبة 🛢️',
  '',
  '<b>ARMCO OIL 🚀</b>',
].join('\n');

function cairoDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendTelegramMessage(token: string, chatId: string, appUrl: string) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({
      chat_id: chatId, text: MESSAGE, parse_mode: 'HTML', disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: '🚀 ابدأ اللعب الآن', web_app: { url: appUrl } }]] },
    }),
  });
  const result = await response.json().catch(() => ({})) as {
    ok?: boolean; description?: string; parameters?: { retry_after?: number };
  };
  if (!response.ok || result.ok !== true) {
    const error = new Error(result.description || `telegram_http_${response.status}`);
    Object.assign(error, { retryAfter: result.parameters?.retry_after ?? 0 });
    throw error;
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!token || !rawAppUrl) return NextResponse.json({ error: 'telegram_broadcast_not_configured' }, { status: 503 });
  let appUrl: string;
  try {
    const parsed = new URL(rawAppUrl);
    if (parsed.protocol !== 'https:') throw new Error('https_required');
    appUrl = parsed.toString().replace(/\/$/, '');
  } catch {
    return NextResponse.json({ error: 'invalid_public_app_url' }, { status: 503 });
  }

  const { day, hour } = cairoDateParts(new Date());
  // Vercel schedules are UTC: 07:00 and 08:00 UTC cover Cairo summer/winter.
  // Only the invocation that sees 10:xx in Cairo is allowed to send.
  if (hour !== 10) return NextResponse.json({ ok: true, skipped: 'outside_cairo_10am', cairoDay: day, cairoHour: hour });

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    await db.execute(`CREATE TABLE IF NOT EXISTS telegram_daily_broadcasts (
      day_key TEXT NOT NULL, telegram_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, sent_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(day_key, telegram_id)
    )`);
    const players = await db.execute({
      sql: "SELECT telegram_id FROM players WHERE status='active' ORDER BY created_at ASC",
    });
    for (const player of players.rows) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO telegram_daily_broadcasts(day_key,telegram_id,status) VALUES(?,?,'pending')",
        args: [day, String(player.telegram_id)],
      });
    }
    const pending = await db.execute({
      sql: "SELECT telegram_id FROM telegram_daily_broadcasts WHERE day_key=? AND status IN ('pending','failed') ORDER BY telegram_id",
      args: [day],
    });
    let sent = 0, failed = 0;
    for (const row of pending.rows) {
      const telegramId = String(row.telegram_id);
      const claim = await db.execute({
        sql: "UPDATE telegram_daily_broadcasts SET status='sending',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE day_key=? AND telegram_id=? AND status IN ('pending','failed')",
        args: [day, telegramId],
      });
      if (claim.rowsAffected !== 1) continue;
      let delivered = false;
      let lastError = 'telegram_send_failed';
      for (let attempt = 0; attempt < 3 && !delivered; attempt++) {
        try {
          await sendTelegramMessage(token, telegramId, appUrl);
          delivered = true;
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'telegram_send_failed';
          const retryAfter = Number((error as { retryAfter?: number }).retryAfter ?? 0);
          if (attempt < 2) await wait(retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 1000 * (attempt + 1));
        }
      }
      if (delivered) {
        await db.execute({
          sql: "UPDATE telegram_daily_broadcasts SET status='sent',last_error=NULL,sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE day_key=? AND telegram_id=?",
          args: [day, telegramId],
        });
        sent++;
      } else {
        await db.execute({
          sql: "UPDATE telegram_daily_broadcasts SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE day_key=? AND telegram_id=?",
          args: [lastError.slice(0, 500), day, telegramId],
        });
        failed++;
      }
      await wait(40);
    }
    return NextResponse.json({ ok: true, cairoDay: day, eligible: players.rows.length, sent, failed });
  } catch (error) {
    console.error('telegram_daily_oil_reminder_failed', error);
    return NextResponse.json({ error: 'telegram_daily_broadcast_failed' }, { status: 500 });
  }
}
