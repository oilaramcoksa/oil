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
    const account = await db.execute({ sql: 'SELECT status FROM players WHERE telegram_id = ?', args: [telegramId] });
    if (account.rows.length && String(account.rows[0].status) !== 'active') {
      return NextResponse.json({ error: 'player_suspended' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    const existing = await db.execute({ sql: 'SELECT referral_code FROM players WHERE telegram_id = ?', args: [telegramId] });
    const referralCode = existing.rows[0]?.referral_code?.toString() ?? randomBytes(6).toString('hex');
    await db.execute({
      sql: `INSERT INTO players (telegram_id, username, first_name, last_name, photo_url, referral_code, last_seen_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(telegram_id) DO UPDATE SET
              username = excluded.username, first_name = excluded.first_name,
              last_name = excluded.last_name, photo_url = excluded.photo_url, last_seen_at = CURRENT_TIMESTAMP`,
      args: [telegramId, identity.username ?? null, identity.first_name ?? null, identity.last_name ?? null, identity.photo_url ?? null, referralCode],
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


    // Record one verified app visit per UTC calendar day. Referral qualification
    // requires three distinct consecutive calendar days after the referral exists.
    const dayKey = new Date().toISOString().slice(0, 10);
    await db.execute({
      sql: 'INSERT OR IGNORE INTO player_login_days(telegram_id, day_key) VALUES(?, ?)',
      args: [telegramId, dayKey],
    });
    const loginDays = await db.execute({
      sql: "SELECT COUNT(*) AS days FROM player_login_days WHERE telegram_id=? AND day_key >= date('now','-2 days') AND day_key <= date('now')",
      args: [telegramId],
    });
    if (Number(loginDays.rows[0]?.days ?? 0) >= 3) {
      await db.execute({
        sql: "UPDATE referrals SET status='qualified' WHERE referee_telegram_id=? AND status='joined'",
        args: [telegramId],
      });
    }

    // Lifetime 5% referral commission. It is an additional platform-funded
    // credit to the inviter; the referred player's wallet is never debited.
    const referral = await db.execute({
      sql: "SELECT referrer_telegram_id FROM referrals WHERE referee_telegram_id=? AND status IN ('qualified','rewarded')",
      args: [telegramId],
    });
    if (referral.rows.length) {
      const referrerId = String(referral.rows[0].referrer_telegram_id);
      const revenue = await db.execute({
        sql: "SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries WHERE telegram_id=? AND asset='coins' AND entry_type='oil_sale' AND date(created_at)=date('now')",
        args: [telegramId],
      });
      const revenueCoins = Math.max(0, Number(revenue.rows[0]?.total ?? 0));
      const tx = await db.transaction('write');
      try {
        const paid = await tx.execute({
          sql: "SELECT commission_coins FROM referral_daily_commissions WHERE referee_telegram_id=? AND day_key=?",
          args: [telegramId, dayKey],
        });
        const alreadyPaid = Number(paid.rows[0]?.commission_coins ?? 0);
        const targetCommission = Math.floor(revenueCoins * 0.05);
        const delta = Math.max(0, targetCommission - alreadyPaid);
        await tx.execute({
          sql: `INSERT INTO referral_daily_commissions(referee_telegram_id,day_key,revenue_coins,commission_coins)
                VALUES(?,?,?,?) ON CONFLICT(referee_telegram_id,day_key) DO UPDATE SET
                revenue_coins=excluded.revenue_coins,commission_coins=excluded.commission_coins,updated_at=CURRENT_TIMESTAMP`,
          args: [telegramId, dayKey, revenueCoins, targetCommission],
        });
        if (delta > 0) {
          await tx.execute({ sql: 'INSERT OR IGNORE INTO player_wallets(telegram_id) VALUES(?)', args: [referrerId] });
          await tx.execute({
            sql: 'UPDATE player_wallets SET coins_balance=coins_balance+?,lifetime_coins_earned=lifetime_coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
            args: [delta, delta, referrerId],
          });
          const balance = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [referrerId] });
          const commissionId = randomBytes(16).toString('hex');
          await tx.execute({
            sql: `INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json)
                  VALUES(?,?,'coins','referral_commission',?,?,'referral',?,?,?)`,
            args: [commissionId, referrerId, delta, Number(balance.rows[0]?.coins_balance ?? 0), telegramId, `referral-commission:${telegramId}:${dayKey}:${targetCommission}`, JSON.stringify({ refereeTelegramId: telegramId, dayKey, revenueCoins, rate: 5 })],
          });
          await tx.execute({
            sql: "UPDATE referrals SET reward_coins=reward_coins+?,status='rewarded' WHERE referee_telegram_id=?",
            args: [delta, telegramId],
          });
        }
        await tx.commit();
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    }

    const partsRows = await db.execute({
      sql: 'SELECT part_id, quantity FROM player_parts WHERE telegram_id = ?',
      args: [telegramId],
    });
    const parts = Object.fromEntries(partsRows.rows.map((row) => [String(row.part_id), Number(row.quantity)]));
    const gameSettings = await db.execute({
      sql: 'SELECT base_oil_per_tap, base_capacity FROM player_game_state WHERE telegram_id = ?',
      args: [telegramId],
    });
    const stats = await db.execute({
      sql: `SELECT COALESCE(taps,0) AS taps, COALESCE(sells,0) AS sells,
                   COALESCE(coins_earned,0) AS coins_earned
            FROM player_monthly_stats WHERE telegram_id = ? AND month_key = ?`,
      args: [telegramId, new Date().toISOString().slice(0, 7)],
    });
    const referralRows = await db.execute({
      sql: `SELECT r.id, r.reward_coins, r.status, r.created_at,
                   p.username, p.first_name, p.last_name
            FROM referrals r
            JOIN players p ON p.telegram_id = r.referee_telegram_id
            WHERE r.referrer_telegram_id = ?
            ORDER BY r.created_at DESC LIMIT 100`,
      args: [telegramId],
    });
    const referrals = referralRows.rows.map((row) => ({
      id: String(row.id),
      name: String(row.username || row.first_name || 'Player'),
      joinedAt: Date.parse(String(row.created_at)) || Date.now(),
      earned: Number(row.reward_coins ?? 0),
      active: String(row.status) === 'qualified' || String(row.status) === 'rewarded',
      status: String(row.status),
    }));
    return NextResponse.json({
      player: { telegramId, username: identity.username ?? null, firstName: identity.first_name ?? null, lastName: identity.last_name ?? null },
      referralCode,
      parts,
      gameSettings: gameSettings.rows[0] ? { baseOilPerTap: Number(gameSettings.rows[0].base_oil_per_tap), baseCapacity: Number(gameSettings.rows[0].base_capacity) } : null,
      referralCount: referrals.length,
      referrals,
      monthlyStats: stats.rows[0] ?? { taps: 0, sells: 0, coins_earned: 0 },
      source: 'turso',
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('player_profile_failed', error);
    return NextResponse.json({ error: 'player_profile_unavailable' }, { status: 503 });
  }
}
