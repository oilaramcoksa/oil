import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!token || !secret || !appUrl) return NextResponse.json({ error: 'telegram_not_configured' }, { status: 503 });
  if (req.headers.get('x-telegram-bot-api-secret-token') !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let update: { message?: { text?: string; chat?: { id: number } } };
  try { update = await req.json(); } catch { return NextResponse.json({ ok: true }); }
  const message = update.message;
  if (!message?.chat?.id || !message.text?.trim().startsWith('/start')) return NextResponse.json({ ok: true });
  const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ chat_id: message.chat.id, text: 'مرحباً بك في Aramco Oil 🛢️\nافتح التطبيق للبدء في اللعب ومتابعة رصيدك ومهامك.', reply_markup: { inline_keyboard: [[{ text: '🚀 فتح Aramco Oil', web_app: { url: appUrl.replace(/\\/$/, '') } }]] } }),
  });
  if (!response.ok) return NextResponse.json({ error: 'telegram_send_failed' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
