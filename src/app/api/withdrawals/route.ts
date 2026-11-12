import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  COINS_PER_USD,
  MIN_UNITS,
  MAX_UNITS_PER_REQUEST,
  isValidTonAddress,
  type WithdrawalRecord,
  type WithdrawalStatus,
} from '@/lib/withdraw';

const USER_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

function serialize(r: {
  id: string; units: number; coins: number; tonAddress: string; status: string;
  txHash: string | null; adminNote: string | null; createdAt: Date; updatedAt: Date;
}): WithdrawalRecord {
  return {
    id: r.id,
    units: r.units,
    coins: r.coins,
    usd: r.units,
    tonAddress: r.tonAddress,
    status: r.status as WithdrawalStatus,
    txHash: r.txHash,
    adminNote: r.adminNote,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

// GET /api/withdrawals?userId=...  → this player's requests (newest first)
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId') ?? '';
  if (!USER_ID_RE.test(userId)) {
    return NextResponse.json({ error: 'invalid_user' }, { status: 400 });
  }
  const rows = await db.withdrawalRequest.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({ withdrawals: rows.map(serialize) });
}

// POST /api/withdrawals  → create a request (no fee is ever charged)
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const userId = String(body.userId ?? '');
  const tonAddress = String(body.tonAddress ?? '').trim();
  const units = Number(body.units);
  const balance = Number(body.balance);

  if (!USER_ID_RE.test(userId)) {
    return NextResponse.json({ error: 'invalid_user' }, { status: 400 });
  }
  if (!Number.isInteger(units) || units < MIN_UNITS || units > MAX_UNITS_PER_REQUEST) {
    return NextResponse.json({ error: 'invalid_amount' }, { status: 400 });
  }
  const coins = units * COINS_PER_USD;
  if (!Number.isFinite(balance) || balance < coins) {
    return NextResponse.json({ error: 'insufficient_balance' }, { status: 400 });
  }
  if (!isValidTonAddress(tonAddress)) {
    return NextResponse.json({ error: 'invalid_address' }, { status: 400 });
  }

  // One open request at a time per player.
  const open = await db.withdrawalRequest.findFirst({
    where: { userId, status: 'pending' },
    select: { id: true },
  });
  if (open) {
    return NextResponse.json({ error: 'pending_exists' }, { status: 409 });
  }

  const snap = (body.snapshot && typeof body.snapshot === 'object') ? body.snapshot : null;
  const row = await db.withdrawalRequest.create({
    data: {
      userId,
      units,
      coins,
      tonAddress,
      snapshot: snap ? JSON.stringify(snap).slice(0, 2000) : null,
    },
  });
  return NextResponse.json({ withdrawal: serialize(row) }, { status: 201 });
}
