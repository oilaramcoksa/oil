import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const COINS_PER_LITER = 5;

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function weekKey(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
}

async function publishSaleToTelegram(input: {
  username?: string;
  firstName?: string;
  telegramId: string;
  sold: number;
  coinsEarned: number;
}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('sale_telegram_broadcast_skipped: TELEGRAM_BOT_TOKEN is not configured');
    return;
  }

  const displayName = input.username
    ? `@${input.username}`
    : input.firstName || `Player ${input.telegramId.slice(-4)}`;
  // This is a virtual in-game conversion, not a cash payment or guaranteed market value.
  const estimatedUsd = input.coinsEarned / 1000;
  const timestamp = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
  }).format(new Date());
  const message = [
    '<b>🛢️ ARMCO OIL — عملية بيع داخل اللعبة</b>',
    '',
    `👤 <b>الحساب:</b> ${escapeHtml(displayName)}`,
    `🛢️ <b>النفط المباع:</b> ${input.sold.toLocaleString('en-US')} لتر`,
    `🪙 <b>العملات المضافة:</b> ${input.coinsEarned.toLocaleString('en-US')}`,
    `💵 <b>القيمة الافتراضية التقديرية:</b> $${estimatedUsd.toFixed(4)}`,
    `🕒 <b>الوقت:</b> ${escapeHtml(timestamp)} (توقيت القاهرة)`,
    '',
  ].join('\n');

  const results = await Promise.all(['@qrmcooil', '@armcooil'].map(async (chatId) => {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; description?: string };
      if (!response.ok || result.ok !== true) {
        console.error('sale_telegram_broadcast_failed', chatId, response.status, result.description ?? 'telegram_send_failed');
        return false;
      }
      return true;
    } catch (error) {
      console.error('sale_telegram_broadcast_failed', chatId, error);
      return false;
    }
  }));

  if (results.some((sent) => !sent)) {
    console.error('sale_telegram_broadcast_partial_failure', { channel: results[0], group: results[1] });
  }
}

export async function POST(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required', 401);
  let body: { idempotencyKey?: unknown };
  try { body = await req.json(); } catch { return fail('invalid_body'); }
  const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) return fail('invalid_idempotency_key');

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const id = String(user.id);
    const tx = await db.transaction('write');
    try {
      const player = await tx.execute({
        sql: "SELECT p.telegram_id,p.fee_exempt,p.mining_fee_paid_at,COALESCE(s.setting_value,'1') AS fee_enabled FROM players p LEFT JOIN app_settings s ON s.setting_key='mining_fee_enabled' WHERE p.telegram_id=? AND p.status='active'",
        args: [id],
      });
      if (!player.rows.length) { await tx.rollback(); return fail('player_not_active', 403); }
      const playerRow = player.rows[0];
      if (String(playerRow.fee_enabled) !== '0' && Number(playerRow.fee_exempt ?? 0) !== 1 && !playerRow.mining_fee_paid_at) {
        await tx.rollback();
        return fail('mining_activation_required', 403);
      }

      // Sell once after the server-recorded 12-hour cycle ends; the full oil balance is sold.
      const cycleState = await tx.execute({
        sql: 'SELECT cycle_ends_at FROM player_game_state WHERE telegram_id=?',
        args: [id],
      });
      const cycleEndsAt = Number(cycleState.rows[0]?.cycle_ends_at ?? 0);
      if (!Number.isSafeInteger(cycleEndsAt) || cycleEndsAt <= 0) { await tx.rollback(); return fail('mining_cycle_not_started', 409); }
      const dayKey = new Date().toISOString().slice(0, 10);
      const cycleKey = `oil_sale_cycle:${id}:${cycleEndsAt}:coins:${dayKey}`;
      const oilCycleKey = `oil_sale_cycle:${id}:${cycleEndsAt}:oil:${dayKey}`;
      const legacyCycleKey = `oil_sale_cycle:${id}:${cycleEndsAt}:coins`;
      const legacyUnscopedKey = `oil_sale_cycle:${cycleEndsAt}:coins`;
      const previous = await tx.execute({
        sql: 'SELECT metadata_json FROM ledger_entries WHERE telegram_id=? AND idempotency_key IN (?,?,?)',
        args: [id, cycleKey, legacyCycleKey, legacyUnscopedKey],
      });
      if (previous.rows.length) {
        const wallet = await tx.execute({ sql: 'SELECT oil_balance, coins_balance FROM player_wallets WHERE telegram_id=?', args: [id] });
        await tx.commit();
        const w = wallet.rows[0];
        const metadata = JSON.parse(String(previous.rows[0].metadata_json ?? '{}')) as { sold?: number; coinsEarned?: number };
        return NextResponse.json({ duplicate: true, sold: Number(metadata.sold ?? 0), coinsEarned: Number(metadata.coinsEarned ?? 0), wallet: { oil: Number(w?.oil_balance ?? 0), coins: Number(w?.coins_balance ?? 0) } }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (Date.now() < cycleEndsAt) {
        await tx.rollback();
        return fail('mining_cycle_active', 409);
      }
      const wallet = await tx.execute({ sql: 'SELECT oil_balance, coins_balance FROM player_wallets WHERE telegram_id=?', args: [id] });
      if (!wallet.rows.length) { await tx.rollback(); return fail('wallet_not_found', 404); }
      const oilAvailable = Number(wallet.rows[0].oil_balance);
      const oldCoins = Number(wallet.rows[0].coins_balance);
      if (!Number.isSafeInteger(oilAvailable) || oilAvailable <= 0) { await tx.rollback(); return fail('no_oil_to_sell', 409); }
      // Sell the complete oil balance in one atomic transaction.
      // Daily coin caps must not leave unsold oil stranded in the player's wallet.
      const sold = oilAvailable;
      const coinsEarned = sold * COINS_PER_LITER;
      const newCoins = oldCoins + coinsEarned;
      if (!Number.isSafeInteger(coinsEarned) || !Number.isSafeInteger(newCoins)) { await tx.rollback(); return fail('invalid_sale_amount', 400); }

      const remainingOil = oilAvailable - sold;
      await tx.execute({
        sql: 'UPDATE player_wallets SET oil_balance=?, coins_balance=?, lifetime_coins_earned=lifetime_coins_earned+?, lifetime_oil_sold=lifetime_oil_sold+?, updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
        args: [remainingOil, newCoins, coinsEarned, sold, id],
      });
      const saleId = randomUUID();
      const metadata = JSON.stringify({ saleId, sold, coinsEarned });
      // Close the oil side of the same atomic sale in the immutable ledger.
      // The wallet update and both asset entries commit or roll back together.
      await tx.execute({
        sql: `INSERT INTO ledger_entries
          (id, telegram_id, asset, entry_type, amount, balance_after, reference_type, reference_id, idempotency_key, metadata_json)
          VALUES (?, ?, 'oil', 'oil_sale', ?, 0, 'oil_sale', ?, ?, ?)`,
        args: [randomUUID(), id, -sold, saleId, oilCycleKey, metadata],
      });
      await tx.execute({
        sql: `INSERT INTO ledger_entries
          (id, telegram_id, asset, entry_type, amount, balance_after, reference_type, reference_id, idempotency_key, metadata_json)
          VALUES (?, ?, 'coins', 'oil_sale', ?, ?, 'oil_sale', ?, ?, ?)`,
        args: [randomUUID(), id, coinsEarned, newCoins, saleId, cycleKey, metadata],
      });

      // Lifetime inviter commission is funded by the platform and applies only
      // to coins credited by oil sales. The referred player's balance is untouched.
      const saleDay = new Date().toISOString().slice(0, 10);
      const loginDays = await tx.execute({
        sql: "SELECT COUNT(*) AS days FROM player_login_days WHERE telegram_id=? AND day_key BETWEEN date('now','-2 days') AND date('now')",
        args: [id],
      });
      if (Number(loginDays.rows[0]?.days ?? 0) >= 3) {
        await tx.execute({
          sql: "UPDATE referrals SET status='qualified' WHERE referee_telegram_id=? AND status='joined'",
          args: [id],
        });
      }
      const referral = await tx.execute({
        sql: "SELECT referrer_telegram_id FROM referrals WHERE referee_telegram_id=? AND status IN ('qualified','rewarded')",
        args: [id],
      });
      if (referral.rows.length) {
        const referrerId = String(referral.rows[0].referrer_telegram_id);
        const dailyRevenue = await tx.execute({
          sql: "SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries WHERE telegram_id=? AND asset='coins' AND entry_type='oil_sale' AND date(created_at)=date('now')",
          args: [id],
        });
        const revenueCoins = Math.max(0, Number(dailyRevenue.rows[0]?.total ?? 0));
        const targetCommission = Math.floor(revenueCoins * 0.05);
        const prior = await tx.execute({
          sql: "SELECT commission_coins FROM referral_daily_commissions WHERE referee_telegram_id=? AND day_key=?",
          args: [id, saleDay],
        });
        const alreadyCredited = Number(prior.rows[0]?.commission_coins ?? 0);
        await tx.execute({ sql: 'INSERT OR IGNORE INTO player_wallets(telegram_id) VALUES(?)', args: [referrerId] });
        const inviterBudget = await tx.execute({
          sql: `SELECT
            COALESCE((SELECT SUM(amount) FROM ledger_entries
              WHERE telegram_id=? AND asset='coins' AND amount>0
                AND entry_type NOT IN ('opening_balance','withdrawal_refund')
                AND datetime(created_at)>=datetime('now','-24 hours')),0) AS coins_earned,
            CASE
              WHEN (SELECT COUNT(DISTINCT part_id) FROM (
                SELECT part_id FROM player_parts WHERE telegram_id=? AND quantity>0
                UNION SELECT part_id FROM player_special_parts WHERE telegram_id=?
                  AND (expires_at IS NULL OR expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)
              ))>=6 THEN 2000
              WHEN EXISTS (SELECT 1 FROM player_upgrades WHERE telegram_id=?
                AND status='active' AND expires_at>CURRENT_TIMESTAMP
                AND package_id IN ('fast_oil','king_oil','super_oil'))
                AND (SELECT COUNT(DISTINCT part_id) FROM (
                  SELECT part_id FROM player_parts WHERE telegram_id=? AND quantity>0
                  UNION SELECT part_id FROM player_special_parts WHERE telegram_id=?
                    AND (expires_at IS NULL OR expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)
                ))>=1 THEN 1500
              ELSE 1000 END AS daily_limit FROM (SELECT 1)`,
          args: [referrerId, referrerId, referrerId, referrerId, referrerId, referrerId],
        });
        const inviterRemaining = Math.max(0, Number(inviterBudget.rows[0]?.daily_limit ?? 1000) - Number(inviterBudget.rows[0]?.coins_earned ?? 0));
        const delta = Math.min(Math.max(0, targetCommission - alreadyCredited), inviterRemaining);
        await tx.execute({
          sql: `INSERT INTO referral_daily_commissions(referee_telegram_id,day_key,revenue_coins,commission_coins)
                VALUES(?,?,?,?) ON CONFLICT(referee_telegram_id,day_key) DO UPDATE SET
                revenue_coins=excluded.revenue_coins,commission_coins=excluded.commission_coins,updated_at=CURRENT_TIMESTAMP`,
          args: [id, saleDay, revenueCoins, targetCommission],
        });
        if (delta > 0) {
          await tx.execute({
            sql: 'UPDATE player_wallets SET coins_balance=coins_balance+?,lifetime_coins_earned=lifetime_coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
            args: [delta, delta, referrerId],
          });
          const inviterWallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [referrerId] });
          await tx.execute({
            sql: `INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json)
                  VALUES(?,?,'coins','referral_commission',? ,?,'referral',?,?,?)`,
            args: [randomUUID(), referrerId, delta, Number(inviterWallet.rows[0]?.coins_balance ?? 0), id,
              `referral-commission:${id}:${saleDay}:${key}`,
              JSON.stringify({ refereeTelegramId: id, saleId, dayKey: saleDay, revenueCoins, rate: 5, source: 'oil_sale' })],
          });
          await tx.execute({
            sql: "UPDATE referrals SET reward_coins=reward_coins+?,status='rewarded' WHERE referee_telegram_id=?",
            args: [delta, id],
          });
          await tx.execute({
            sql: "INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,'referral_commission',?,?,?)",
            args: [randomUUID(), referrerId, delta, JSON.stringify({ refereeTelegramId: id, saleId, rate: 5 }), `referral-commission-notice:${id}:${saleDay}:${key}`],
          });
        }
      }

      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      const week = weekKey(now);
      await tx.execute({
        sql: `INSERT INTO player_daily_stats(telegram_id, day_key, sells, oil_sold, coins_earned)
              VALUES (?, ?, 1, ?, ?) ON CONFLICT(telegram_id, day_key) DO UPDATE SET
              sells=sells+1, oil_sold=oil_sold+excluded.oil_sold,
              coins_earned=coins_earned+excluded.coins_earned, updated_at=CURRENT_TIMESTAMP`,
        args: [id, day, sold, coinsEarned],
      });
      await tx.execute({
        sql: `INSERT INTO player_monthly_stats(telegram_id, month_key, sells, oil_sold, coins_earned)
              VALUES (?, ?, 1, ?, ?) ON CONFLICT(telegram_id, month_key) DO UPDATE SET
              sells=sells+1, oil_sold=oil_sold+excluded.oil_sold,
              coins_earned=coins_earned+excluded.coins_earned, updated_at=CURRENT_TIMESTAMP`,
        args: [id, month, sold, coinsEarned],
      });
      await tx.execute({
        sql: `INSERT INTO player_weekly_stats(telegram_id, week_key, sells, oil_sold)
              VALUES (?, ?, 1, ?) ON CONFLICT(telegram_id, week_key) DO UPDATE SET
              sells=sells+1, oil_sold=oil_sold+excluded.oil_sold, updated_at=CURRENT_TIMESTAMP`,
        args: [id, week, sold],
      });
      await tx.execute({
        sql: `INSERT INTO player_events(id, telegram_id, event_type, amount, metadata_json, idempotency_key)
              VALUES (?, ?, 'oil_sale', ?, ?, ?)`,
        args: [randomUUID(), id, coinsEarned, metadata, `event:oil_sale:${key}`],
      });

      await tx.commit();
      await publishSaleToTelegram({ username: user.username, firstName: user.first_name, telegramId: id, sold, coinsEarned });
      return NextResponse.json({ ok: true, saleId, sold, coinsEarned, wallet: { oil: remainingOil, coins: newCoins } }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    console.error('oil_sale_failed', error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error);
    return fail('oil_sale_failed', 503);
  }
}
