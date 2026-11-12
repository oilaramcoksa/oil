import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getVerifiedTelegramUser } from '@/lib/telegram-auth';
import { type WithdrawalRecord, type WithdrawalStatus } from '@/lib/withdraw';

function serialize(r: { id: string; units: number; coins: number; tonAddress: string; status: string; txHash: string | null; adminNote: string | null; createdAt: Date; updatedAt: Date; }): WithdrawalRecord {
  return { id: r.id, units: r.units, coins: r.coins, usd: r.units, tonAddress: r.tonAddress, status: r.status as WithdrawalStatus, txHash: r.txHash, adminNote: r.adminNote, createdAt: r.createdAt.getTime(), updatedAt: r.updatedAt.getTime() };
}

// Account identity is derived exclusively from Telegram-signed initData.
export async function GET(req: NextRequest) {
  const user = getVerifiedTelegramUser(req);
  if (!user) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });
  const rows = await db.withdrawalRequest.findMany({ where: { userId: 'tg_' + user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  return NextResponse.json({ withdrawals: rows.map(serialize) }, { headers: { 'Cache-Control': 'no-store, private' } });
}

// Real-value payouts stay disabled until balances and rewards are server-authoritative.
// Browser localStorage and client-supplied balances are never proof of funds.
export async function POST() {
  return NextResponse.json({ error: 'withdrawals_temporarily_disabled', message: 'السحب متوقف مؤقتًا حتى تفعيل دفتر أرصدة موثوق على الخادم.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}