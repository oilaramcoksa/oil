import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function verifyTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  params.delete('hash');
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + '=' + value).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const supplied = Buffer.from(hash, 'hex');
  if (supplied.length !== calculated.length || !timingSafeEqual(supplied, calculated)) return null;
  const rawUser = params.get('user');
  if (!rawUser) return null;
  let user: Record<string, unknown>;
  try { user = JSON.parse(rawUser); } catch { return null; }
  if (!Number.isSafeInteger(user.id)) return null;
  return { user, startParam: params.get('start_param') };
}

export async function POST(req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ error: 'telegram_not_configured' }, { status: 503 });
  let body: { initData?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
  if (typeof body.initData !== 'string' || body.initData.length > 8192) return NextResponse.json({ error: 'invalid_init_data' }, { status: 400 });
  const verified = verifyTelegramInitData(body.initData, botToken);
  if (!verified) return NextResponse.json({ error: 'telegram_auth_failed' }, { status: 401 });
  return NextResponse.json(verified, { headers: { 'Cache-Control': 'no-store, private' } });
}
