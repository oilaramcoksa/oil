import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TelegramMessage = {
  text?: string;
  chat?: { id: number };
  from?: { id: number; username?: string; first_name?: string; last_name?: string };
};

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!token || !secret || !appUrl) return NextResponse.json({ error: 'telegram_not_configured' }, { status: 503 });
  if (req.headers.get('x-telegram-bot-api-secret-token') !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let update: { message?: TelegramMessage };
  try { update = await req.json(); } catch { return NextResponse.json({ ok: true }); }
  const message = update.message;
  const text = message?.text?.trim() ?? '';
  const match = text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?/);
  if (!message?.chat?.id || !message.from?.id || !match) return NextResponse.json({ ok: true });

  // A bot /start payload is different from Mini App initData.start_param.
  // Attribute the referral here, at the moment Telegram delivers /start <payload>.
  const payload = match[1] ?? '';
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const newUserId = String(message.from.id);
    const ownCode = randomBytes(6).toString('hex');
    await db.execute({
      sql: `INSERT INTO players (telegram_id, username, first_name, last_name, referral_code, last_seen_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(telegram_id) DO UPDATE SET
              username = COALESCE(excluded.username, players.username),
              first_name = COALESCE(excluded.first_name, players.first_name),
              last_name = COALESCE(excluded.last_name, players.last_name),
              last_seen_at = CURRENT_TIMESTAMP`,
      args: [newUserId, message.from.username ?? null, message.from.first_name ?? null, message.from.last_name ?? null, ownCode],
    });

    if (payload.startsWith('ref_')) {
      const code = payload.slice(4);
      const referrer = await db.execute({
        sql: 'SELECT telegram_id FROM players WHERE referral_code = ?',
        args: [code],
      });
      const referrerId = referrer.rows[0]?.telegram_id?.toString();
      if (referrerId && referrerId !== newUserId) {
        await db.execute({
          sql: `INSERT INTO referrals (id, referrer_telegram_id, referee_telegram_id)
                VALUES (?, ?, ?) ON CONFLICT(referee_telegram_id) DO NOTHING`,
          args: [randomBytes(16).toString('hex'), referrerId, newUserId],
        });
      }
    }
  } catch (error) {
    console.error('telegram_referral_attribution_failed', error);
    // Still respond to /start; the Mini App profile sync can retry player creation.
  }

  const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      chat_id: message.chat.id,
      text: 'مرحباً بك في Aramco Oil 🛢️\nافتح التطبيق للبدء في اللعب ومتابعة رصيدك ومهامك.',
      reply_markup: {
        inline_keyboard: [[{ text: '🚀 فتح Aramco Oil', web_app: { url: appUrl.replace(/\/$/, '') } }]],
      },
    }),
  });
  if (!response.ok) return NextResponse.json({ error: 'telegram_send_failed' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
