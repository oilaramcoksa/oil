import { NextRequest, NextResponse } from 'next/server';
import { ensurePlayerSchema, getTurso } from '@/lib/turso';
import { getStartParam, verifiedPlayerFromRequest } from '@/lib/telegram-player';
import { randomBytes } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const identity = verifiedPlayerFromRequest(req);
  if (!identity) return NextResponse.json({ error: 'telegram_auth_required' }, { status: 401 });
  try {
    await ensurePlayerSchema();
    const db = getTurso();
    const telegramId = String(identity.id);
    const existing = await db.execute({ sql: 'SELECT referral_code FROM players WHERE telegram_id = ?', args: [telegramId] });
    const referralCode = existing.rows[0]?.referral_code?.toString() ?? randomBytes(6).toString('hex');
    await db.execute({
      sql: `INSERT INTO players (telegram_id, username, first_name, last_name, referral_code, last_seen_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(telegram_id) DO UPDATE SET
              username = excluded.username, first_name = excluded.first_name,
              last_name = excluded.last_name, last_seen_at = CURRENT_TIMESTAMP`,
      args: [telegramId, identity.username ?? null, identity.first_name ?? null, identity.last_name ?? null, referralCode],
    });

    await db.execute({
      sql: 'INSERT OR IGNORE INTO player_monthly_stats (telegram_id, month_key) VALUES (?, ?)',
      args: [telegramId, new Date().toISOString().slice(0, 7)],
    });

    await db.execute({ sql: 'INSERT OR IGNORE INTO player_wallets(telegram_id) VALUES (?)', args: [telegramId] });
    await db.execute({ sql: 'INSERT OR IGNORE INTO player_game_state(telegram_id) VALUES (?)', args: [telegramId] });
    await db.execute({
      sql: 'INSERT OR IGNORE INTO player_monthly_stats(telegram_id, month_key) VALUES (?, ?)',
      args: [telegramId, new Date().toISOString().slice(0, 7)],
    });

    const startParam = getStartParam(req);
    if (startParam?.startsWith('ref_')) {
      const code = startParam.slice(4).slice(0, 64);
      const referrer = await db.execute({ sql: 'SELECT telegram_id FROM players WHERE referral_code = ?', args: [code] });
      const referrerId = referrer.rows[0]?.telegram_id?.toString();
      if (referrerId && referrerId !== telegramId) {
        await db.execute({
          sql: `INSERT INTO referrals (id, referrer_telegram_id, referee_telegram_id)
                VALUES (?, ?, ?) ON CONFLICT(referee_telegram_id) DO NOTHING`,
          args: [randomBytes(16).toString('hex'), referrerId, telegramId],
        });
      }
    }

    const stats = await db.execute({
      sql: `SELECT COALESCE(taps,0) AS taps, COALESCE(sells,0) AS sells,
                   COALESCE(coins_earned,0) AS coins_earned
            FROM player_monthly_stats WHERE telegram_id = ? AND month_key = ?`,
      args: [telegramId, new Date().toISOString().slice(0, 7)],
    });
    const referralCount = await db.execute({
      sql: 'SELECT COUNT(*) AS total FROM referrals WHERE referrer_telegram_id = ?',
      args: [telegramId],
    });
    return NextResponse.json({
      player: { telegramId, username: identity.username ?? null, firstName: identity.first_name ?? null, lastName: identity.last_name ?? null },
      referralCode,
      referralCount: Number(referralCount.rows[0]?.total ?? 0),
      monthlyStats: stats.rows[0] ?? { taps: 0, sells: 0, coins_earned: 0 },
      source: 'turso',
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('player_profile_failed', error);
    return NextResponse.json({ error: 'player_profile_unavailable' }, { status: 503 });
  }
}
