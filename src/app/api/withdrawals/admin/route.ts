import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: NextRequest): boolean | 'unconfigured' {
  const token = process.env.ADMIN_TOKEN;
  if (!token || token.length < 32) return 'unconfigured';
  return req.headers.get('authorization') === `Bearer ${token}`;
}

export async function GET(req: NextRequest) {
  const ok = authorized(req);
  if (ok === 'unconfigured') return NextResponse.json({ error: 'admin_disabled' }, { status: 503 });
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    await ensureDatabaseSchema();
    const status = req.nextUrl.searchParams.get('status') ?? 'pending';
    const result = status === 'all'
      ? await getTurso().execute('SELECT * FROM withdrawal_requests ORDER BY created_at ASC LIMIT 200')
      : await getTurso().execute({ sql: 'SELECT * FROM withdrawal_requests WHERE status = ? ORDER BY created_at ASC LIMIT 200', args: [status] });
    return NextResponse.json({ withdrawals: result.rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('admin_withdrawal_list_failed', error);
    return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
  }
}

export async function PATCH(req: NextRequest) {
  const ok = authorized(req);
  if (ok === 'unconfigured') return NextResponse.json({ error: 'admin_disabled' }, { status: 503 });
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }

  const id = String(body.id ?? '').slice(0, 128);
  const status = String(body.status ?? '');
  const txHash = body.txHash ? String(body.txHash).slice(0, 128) : null;
  const adminNote = body.adminNote ? String(body.adminNote).slice(0, 500) : null;
  if (!id || (status !== 'paid' && status !== 'rejected')) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  if (status === 'paid' && !txHash) return NextResponse.json({ error: 'txhash_required' }, { status: 400 });

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const result = await db.execute({
      sql: `UPDATE withdrawal_requests
            SET status = ?, tx_hash = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'pending'`,
      args: [status, txHash, adminNote, id],
    });
    if (Number(result.rowsAffected) === 0) return NextResponse.json({ error: 'not_pending_or_missing' }, { status: 409 });
    await db.execute({
      sql: 'INSERT INTO admin_audit_logs(id, admin_id, action, target_type, target_id, details_json) VALUES (?, ?, ?, ?, ?, ?)',
      args: [randomUUID(), 'admin_token', `withdrawal_${status}`, 'withdrawal', id, JSON.stringify({ txHash, adminNote })],
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('admin_withdrawal_update_failed', error);
    return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
  }
}
