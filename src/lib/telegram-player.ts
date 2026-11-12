import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

export interface TelegramPlayerIdentity {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export function verifiedPlayerFromRequest(req: NextRequest): TelegramPlayerIdentity | null {
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
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  const supplied = Buffer.from(hash, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  const raw = params.get('user');
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as TelegramPlayerIdentity;
    return Number.isSafeInteger(user.id) && user.id > 0 ? user : null;
  } catch { return null; }
}

export function getStartParam(req: NextRequest): string | null {
  const initData = req.headers.get('x-telegram-init-data');
  if (!initData) return null;
  return new URLSearchParams(initData).get('start_param');
}
