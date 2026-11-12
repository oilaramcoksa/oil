import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Reviewer endpoint. Protected by the ADMIN_TOKEN environment variable:
//   curl -H "Authorization: Bearer $ADMIN_TOKEN" /api/withdrawals/admin
//   curl -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
//        -d '{"id":"...","status":"paid","txHash":"<TON tx hash>"}' /api/withdrawals/admin
//   curl -X PATCH ... -d '{"id":"...","status":"rejected","adminNote":"reason"}'
// A rejected request is refunded to the player's in-game balance automatically
// the next time their app syncs.

function authorized(req: NextRequest): boolean | 'unconfigured' {
  const token = process.env.ADMIN_TOKEN;
  if (!token || token.length < 16) return 'unconfigured';
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${token}`;
}

export async function GET(req: NextRequest) {
  const ok = authorized(req);
  if (ok === 'unconfigured') return NextResponse.json({ error: 'admin_disabled' }, { status: 503 });
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const status = req.nextUrl.searchParams.get('status') ?? 'pending';
  const rows = await db.withdrawalRequest.findMany({
    where: status === 'all' ? {} : { status },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return NextResponse.json({ withdrawals: rows });
}

export async function PATCH(req: NextRequest) {
  const ok = authorized(req);
  if (ok === 'unconfigured') return NextResponse.json({ error: 'admin_disabled' }, { status: 503 });
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const id = String(body.id ?? '');
  const status = String(body.status ?? '');
  const txHash = body.txHash ? String(body.txHash).slice(0, 128) : null;
  const adminNote = body.adminNote ? String(body.adminNote).slice(0, 500) : null;

  if (status !== 'paid' && status !== 'rejected') {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  }
  if (status === 'paid' && !txHash) {
    return NextResponse.json({ error: 'txhash_required' }, { status: 400 });
  }

  // Only a pending request can be resolved (atomic guard against double updates).
  const result = await db.withdrawalRequest.updateMany({
    where: { id, status: 'pending' },
    data: { status, txHash, adminNote },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: 'not_pending_or_missing' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
