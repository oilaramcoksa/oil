import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';

export interface VerifiedTelegramUser { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string; }

/** Verify raw Telegram initData. Never trust initDataUnsafe. */
export function getVerifiedTelegramUser(req: NextRequest): VerifiedTelegramUser | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const initData = req.headers.get('x-telegram-init-data');
  if (!token || !initData || initData.length > 8192) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  params.delete('hash');
  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate > now + 60 || now - authDate > 3600) return null;
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + '=' + value).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const supplied = Buffer.from(hash, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  const rawUser = params.get('user');
  if (!rawUser) return null;
  try { const user = JSON.parse(rawUser) as VerifiedTelegramUser; return Number.isSafeInteger(user.id) && user.id > 0 ? user : null; }
  catch { return null; }
}