import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const REWARD = 200;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function storyLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(url.hostname)) return null;
    if (!url.pathname.includes('/s/')) return null;
    return url.toString();
  } catch { return null; }
}

function timestamp(value: unknown): number | null {
  if (!value) return null;
  const raw = String(value);
  const parsed = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(req: NextRequest) {
  const player = verifiedPlayerFromRequest(req);
  if (!player) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });
  try {
    await ensureDatabaseSchema();
    const id = String(player.id);
    const [pending, lastApproved, latest] = await Promise.all([
      getTurso().execute({ sql: "SELECT id,story_url,status,submitted_at FROM telegram_story_submissions WHERE telegram_id=? AND status='pending' ORDER BY submitted_at DESC LIMIT 1", args: [id] }),
      getTurso().execute({ sql: "SELECT reviewed_at FROM telegram_story_submissions WHERE telegram_id=? AND status='approved' ORDER BY reviewed_at DESC LIMIT 1", args: [id] }),
      getTurso().execute({ sql: 'SELECT id,story_url,status,submitted_at,reviewed_at,review_reason FROM telegram_story_submissions WHERE telegram_id=? ORDER BY submitted_at DESC LIMIT 1', args: [id] }),
    ]);
    const approvedAt = timestamp(lastApproved.rows[0]?.reviewed_at);
    const nextAllowedAt = approvedAt ? approvedAt + COOLDOWN_MS : null;
    return NextResponse.json({
      reward: REWARD,
      pending: pending.rows[0] ?? null,
      latest: latest.rows[0] ?? null,
      nextAllowedAt,
      canSubmit: pending.rows.length === 0 && (!nextAllowedAt || Date.now() >= nextAllowedAt),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('telegram_story_status_failed', error);
    return NextResponse.json({ error: 'story_status_unavailable' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const player = verifiedPlayerFromRequest(req);
  if (!player) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });
  let body: { storyUrl?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
  const url = storyLink(body.storyUrl);
  if (!url) return NextResponse.json({ error: 'invalid_story_link' }, { status: 400 });

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const telegramId = String(player.id);
    const tx = await db.transaction('write');
    try {
      const pending = await tx.execute({ sql: "SELECT id FROM telegram_story_submissions WHERE telegram_id=? AND status='pending' LIMIT 1", args: [telegramId] });
      if (pending.rows.length) { await tx.rollback(); return NextResponse.json({ error: 'story_review_pending' }, { status: 409 }); }
      const last = await tx.execute({ sql: "SELECT reviewed_at FROM telegram_story_submissions WHERE telegram_id=? AND status='approved' ORDER BY reviewed_at DESC LIMIT 1", args: [telegramId] });
      const approvedAt = timestamp(last.rows[0]?.reviewed_at);
      const nextAllowedAt = approvedAt ? approvedAt + COOLDOWN_MS : null;
      if (nextAllowedAt && Date.now() < nextAllowedAt) {
        await tx.rollback();
        return NextResponse.json({ error: 'story_cooldown', nextAllowedAt }, { status: 429 });
      }
      const id = randomUUID();
      await tx.execute({
        sql: "INSERT INTO telegram_story_submissions(id,telegram_id,story_url,status) VALUES(?,?,?,'pending')",
        args: [id, telegramId, url],
      });
      await tx.commit();
      return NextResponse.json({ ok: true, id, status: 'pending', reward: REWARD }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    console.error('telegram_story_submit_failed', error);
    return NextResponse.json({ error: 'story_submit_failed' }, { status: 503 });
  }
}
