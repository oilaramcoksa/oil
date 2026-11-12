import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { getVerifiedTelegramUser } from '@/lib/telegram-auth';
import { PACKAGES, WALLETS } from '@/lib/wallets';

const SHOP_PARTS = [
  { id: 'oil_pump', priceTon: 0.5 },
  { id: 'fuel_station', priceTon: 0.3 },
  { id: 'oil_truck', priceTon: 0.1 },
] as const;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const user = getVerifiedTelegramUser(req);
  if (!user) return error('telegram_auth_required', 401);
  let body: { packageId?: unknown; walletCode?: unknown; itemId?: unknown };
  try { body = await req.json(); } catch { return error('invalid_body', 400); }
  const pkg = PACKAGES.find((p) => p.id === body.packageId);
  const part = SHOP_PARTS.find((p) => p.id === body.itemId);
  const wallet = body.itemId ? WALLETS.find((w) => w.code === 'gram') : WALLETS.find((w) => w.code === body.walletCode);
  if ((!pkg && !part) || !wallet) return error('invalid_package_or_wallet', 400);

  try {
    await ensureDatabaseSchema();
    const id = randomUUID();
    const db = getTurso();
    await db.execute({
      sql: `INSERT INTO payment_transactions
        (id, telegram_id, provider, asset, network, amount, package_id, status, provider_payload_json)
        VALUES (?, ?, 'manual_crypto', ?, ?, ?, ?, 'pending', ?)`,
      args: [id, String(user.id), part ? 'TON' : wallet.code, part ? 'TON' : wallet.network, String(part ? part.priceTon : pkg!.priceUSD), part?.id ?? pkg!.id,
        JSON.stringify({ destination: wallet.address, expiresInMinutes: 60, kind: part ? 'shop_part' : 'upgrade_package' })],
    });
    return NextResponse.json({
      payment: { id, status: 'pending', itemId: part?.id ?? null, packageId: pkg?.id ?? null, amount: part ? part.priceTon : pkg!.priceUSD, currency: part ? 'TON' : 'USD', destination: wallet.address, expiresAt: Date.now() + 60 * 60 * 1000 },
      message: 'payment_verification_pending',
      source: 'turso',
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('payment_request_failed', e);
    return error('payment_request_failed', 503);
  }
}

export async function GET(req: NextRequest) {
  const user = getVerifiedTelegramUser(req);
  if (!user) return error('telegram_auth_required', 401);
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!id || id.length > 64) return error('invalid_payment_id', 400);
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    await db.execute({
      sql: `UPDATE payment_transactions SET status = 'expired'
            WHERE id = ? AND telegram_id = ? AND status = 'pending'
              AND datetime(created_at) <= datetime('now', '-1 hour')`,
      args: [id, String(user.id)],
    });
    const result = await db.execute({
      sql: 'SELECT id, status, package_id, created_at FROM payment_transactions WHERE id = ? AND telegram_id = ?',
      args: [id, String(user.id)],
    });
    if (!result.rows.length) return error('payment_not_found', 404);
    const row = result.rows[0];
    return NextResponse.json({
      payment: { id: String(row.id), status: String(row.status), packageId: String(row.package_id), createdAt: String(row.created_at) },
      source: 'turso',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('payment_status_failed', e);
    return error('payment_status_unavailable', 503);
  }
}
