import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { checkAndRevokeMembership, type TelegramMembershipTask } from '@/lib/telegram-membership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    await ensureDatabaseSchema();
    const due = await getTurso().execute({
      sql: `SELECT telegram_id, task_id FROM task_claims
            WHERE task_id IN ('telegram_channel','telegram_group')
              AND active=1
              AND (last_checked_at IS NULL OR last_checked_at <= datetime('now','-10 hours'))
            ORDER BY last_checked_at ASC LIMIT 500`,
    });
    let checked = 0;
    let revoked = 0;
    for (const row of due.rows) {
      const taskId: TelegramMembershipTask = String(row.task_id) === 'telegram_channel' ? 'channel' : 'group';
      const result = await checkAndRevokeMembership(String(row.telegram_id), taskId);
      checked += 1;
      if (result.revoked) revoked += 1;
    }
    return NextResponse.json({ ok: true, checked, revoked });
  } catch (error) {
    console.error('telegram_membership_cron_failed', error);
    return NextResponse.json({ error: 'membership_check_failed' }, { status: 500 });
  }
}
