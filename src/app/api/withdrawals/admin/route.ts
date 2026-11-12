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
    const tx = await getTurso().transaction('write');
    try {
      const pending = await tx.execute({
        sql: 'SELECT telegram_id, coins FROM withdrawal_requests WHERE id = ? AND status = \'pending\'',
        args: [id],
      });
      if (!pending.rows.length) {
        await tx.rollback();
        return NextResponse.json({ error: 'not_pending_or_missing' }, { status: 409 });
      }
      const telegramId = String(pending.rows[0].telegram_id);
      const coins = Number(pending.rows[0].coins);
      const walletUpdate = status === 'rejected'
        ? await tx.execute({
            sql: `UPDATE player_wallets SET coins_locked = coins_locked - ?, coins_balance = coins_balance + ?, updated_at = CURRENT_TIMESTAMP
                  WHERE telegram_id = ? AND coins_locked >= ?`,
            args: [coins, coins, telegramId, coins],
          })
        : await tx.execute({
            sql: `UPDATE player_wallets SET coins_locked = coins_locked - ?, updated_at = CURRENT_TIMESTAMP
                  WHERE telegram_id = ? AND coins_locked >= ?`,
            args: [coins, telegramId, coins],
          });
      if (Number(walletUpdate.rowsAffected) !== 1) throw new Error('withdrawal_locked_balance_inconsistent');
      const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id = ?', args: [telegramId] });
      const balanceAfter = Number(wallet.rows[0]?.coins_balance ?? 0);
      const result = await tx.execute({
        sql: `UPDATE withdrawal_requests
              SET status = ?, tx_hash = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND status = 'pending'`,
        args: [status, txHash, adminNote, id],
      });
      if (Number(result.rowsAffected) !== 1) throw new Error('withdrawal_status_race');
      if (status === 'rejected') {
        await tx.execute({
          sql: `INSERT INTO ledger_entries
            (id, telegram_id, asset, entry_type, amount, balance_after, reference_type, reference_id, idempotency_key, metadata_json)
            VALUES (?, ?, 'coins', 'withdrawal_refund', ?, ?, 'withdrawal', ?, ?, ?)`,
          args: [randomUUID(), telegramId, coins, balanceAfter, id, `withdrawal-refund:${id}`, JSON.stringify({ adminNote })],
        });
        await tx.execute({
          sql: `INSERT INTO player_events(id, telegram_id, event_type, amount, metadata_json, idempotency_key)
                VALUES (?, ?, 'withdrawal_refunded', ?, ?, ?)`,
          args: [randomUUID(), telegramId, coins, JSON.stringify({ withdrawalId: id }), `withdrawal-refund-event:${id}`],
        });
      }
      await tx.execute({
        sql: 'INSERT INTO admin_audit_logs(id, admin_id, action, target_type, target_id, details_json) VALUES (?, ?, ?, ?, ?, ?)',
        args: [randomUUID(), 'admin_token', `withdrawal_${status}`, 'withdrawal', id, JSON.stringify({ txHash, adminNote, telegramId, coins })],
      });
      await tx.commit();
      return NextResponse.json({ ok: true });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    console.error('admin_withdrawal_update_failed', error);
    return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
  }
}
