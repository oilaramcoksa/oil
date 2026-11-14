import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const COOKIE = 'aramco_admin';
const attempts = new Map<string, { count: number; lockedUntil: number }>();

function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, iterationsRaw, saltHex, keyHex, ...rest] = stored.split('$');
  if (algorithm !== 'pbkdf2_sha256' || rest.length || !/^\d+$/.test(iterationsRaw ?? '') ||
      !/^[a-f0-9]{32,128}$/i.test(saltHex ?? '') || !/^[a-f0-9]{64}$/i.test(keyHex ?? '')) return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isSafeInteger(iterations) || iterations < 300000 || iterations > 2000000) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), iterations, expected.length, 'sha256');
  return timingSafeEqual(actual, expected);
}

export async function POST(req: NextRequest) {
  let body: { password?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
  const password = typeof body.password === 'string' ? body.password : '';
  const stored = process.env.ADMIN_PASSWORD_HASH ?? '';
  const secret = process.env.ADMIN_SESSION_SECRET ?? '';
  if (!stored || secret.length < 32) return NextResponse.json({ error: 'admin_not_configured' }, { status: 503 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const state = attempts.get(ip);
  if (state && state.lockedUntil > now) {
    return NextResponse.json({ error: 'login_temporarily_locked' }, { status: 429 });
  }
  const valid = !!password && password.length <= 256 && verifyPassword(password, stored);
  if (!valid) {
    const count = state && state.lockedUntil <= now ? state.count + 1 : 1;
    attempts.set(ip, { count, lockedUntil: count >= 5 ? now + 15 * 60 * 1000 : 0 });
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }
  attempts.delete(ip);
  const issued = String(now);
  const nonce = randomBytes(32).toString('hex');
  const payload = `${issued}.${nonce}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  const cookie = Buffer.from(`${payload}.${signature}`).toString('base64url');
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/admin',
    maxAge: 60 * 60 * 8,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/admin',
    maxAge: 0,
  });
  return response;
}
