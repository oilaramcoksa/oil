import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { getVerifiedTelegramUser } from '@/lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Withdrawal history is read from the same Turso database as player profiles.
// New requests remain disabled until server-authoritative balances are implemented.
export async function GET(req: NextRequest) {
  const user = getVerifiedTelegramUser(req);
  if (!user) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });
  try {
    await ensureDatabaseSchema();
    const result = await getTurso().execute({
      sql: `SELECT id, units, coins, ton_address, status, tx_hash, admin_note, created_at, updated_at
            FROM withdrawal_requests WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 50`,
      args: [String(user.id)],
    });
    const withdrawals = result.rows.map((row) => ({
      id: String(row.id),
      units: Number(row.units),
      coins: Number(row.coins),
      usd: Number(row.units),
      tonAddress: String(row.ton_address),
      status: String(row.status),
      txHash: row.tx_hash ? String(row.tx_hash) : null,
      adminNote: row.admin_note ? String(row.admin_note) : null,
      createdAt: Date.parse(String(row.created_at)) || 0,
      updatedAt: Date.parse(String(row.updated_at)) || 0,
    }));
    return NextResponse.json({ withdrawals }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('withdrawal_history_failed', error);
    return NextResponse.json({ error: 'withdrawal_history_unavailable' }, { status: 503 });
  }
}

export async function POST() {
  return NextResponse.json(
    { error: 'withdrawals_temporarily_disabled', message: 'السحب متوقف مؤقتًا حتى تفعيل دفتر أرصدة موثوق على الخادم.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
