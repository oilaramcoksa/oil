import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const COOKIE = 'aramco_admin';

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

  const ip = req.headers.get('x-real-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  let ipKey = '';
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    await db.execute(`CREATE TABLE IF NOT EXISTS admin_login_attempts (
      ip_hash TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      window_started_at INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0
    )`);
    ipKey = createHmac('sha256', secret).update(ip).digest('hex');
    const stateResult = await db.execute({
      sql: 'SELECT attempts, window_started_at, locked_until FROM admin_login_attempts WHERE ip_hash=?',
      args: [ipKey],
    });
    const state = stateResult.rows[0];
    if (Number(state?.locked_until ?? 0) > now) {
      return NextResponse.json({ error: 'login_temporarily_locked' }, { status: 429 });
    }
    const valid = !!password && password.length <= 256 && verifyPassword(password, stored);
    if (!valid) {
      await db.execute({
        sql: `INSERT INTO admin_login_attempts(ip_hash,attempts,window_started_at,locked_until)
          VALUES(?,1,?,0)
          ON CONFLICT(ip_hash) DO UPDATE SET
            attempts=CASE WHEN admin_login_attempts.window_started_at <= ? THEN 1 ELSE admin_login_attempts.attempts+1 END,
            window_started_at=CASE WHEN admin_login_attempts.window_started_at <= ? THEN excluded.window_started_at ELSE admin_login_attempts.window_started_at END,
            locked_until=CASE
              WHEN (CASE WHEN admin_login_attempts.window_started_at <= ? THEN 1 ELSE admin_login_attempts.attempts+1 END) >= 5
              THEN ? ELSE admin_login_attempts.locked_until END`,
        args: [ipKey, now, now - 15 * 60 * 1000, now - 15 * 60 * 1000, now - 15 * 60 * 1000, now + 15 * 60 * 1000],
      });
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }
    await db.execute({ sql: 'DELETE FROM admin_login_attempts WHERE ip_hash=?', args: [ipKey] });
  } catch (error) {
    console.error('admin_login_rate_limit_unavailable', error);
    return NextResponse.json({ error: 'admin_login_temporarily_unavailable' }, { status: 503 });
  }
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
