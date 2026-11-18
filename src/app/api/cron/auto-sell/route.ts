import { createHmac, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { POST as settleMining } from '@/app/api/mining/action/route';
import { POST as sellOil } from '@/app/api/sell/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CYCLE_MS = 12 * 60 * 60 * 1000;

function internalInitData(telegramId: string, botToken: string): string {
  const userId = Number(telegramId);
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('invalid_telegram_id');
  const params = new URLSearchParams();
  params.set('auth_date', String(Math.floor(Date.now() / 1000)));
  params.set('user', JSON.stringify({ id: userId }));
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

function internalRequest(path: string, initData: string, body: Record<string, unknown>) {
  return new NextRequest(`https://armcooil.internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
    body: JSON.stringify(body),
  });
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  const supplied = req.headers.get('authorization') ?? '';
  if (secret.length < 16 || supplied !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ error: 'telegram_not_configured' }, { status: 503 });

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const now = Date.now();
    const due = await db.execute({
      sql: `SELECT p.telegram_id, gs.cycle_ends_at, MAX(sp.expires_at) AS expires_at
        FROM players p
        JOIN player_game_state gs ON gs.telegram_id=p.telegram_id
        JOIN player_special_parts sp ON sp.telegram_id=p.telegram_id AND sp.part_id='auto_sell'
        LEFT JOIN player_product_controls pc
          ON pc.telegram_id=p.telegram_id AND pc.product_id='auto_sell' AND pc.product_type='part'
        WHERE p.status='active'
          AND (p.fee_exempt=1 OR p.mining_fee_paid_at IS NOT NULL)
          AND sp.expires_at IS NOT NULL AND sp.expires_at>?
          AND (
            (gs.cycle_ends_at IS NULL AND (
              sp.expires_at>? OR EXISTS (
                SELECT 1 FROM player_wallets w
                WHERE w.telegram_id=p.telegram_id AND w.oil_balance>0
              )
            ))
            OR (gs.cycle_ends_at IS NOT NULL AND gs.cycle_ends_at<=?)
          )
          AND COALESCE(pc.status,'active')='active'
        GROUP BY p.telegram_id,gs.cycle_ends_at
        ORDER BY COALESCE(gs.cycle_ends_at,0) ASC LIMIT 50`,
      args: [now, now + CYCLE_MS, now],
    });

    let soldPlayers = 0;
    let advancedCycles = 0;
    let startedCycles = 0;
    let failedPlayers = 0;
    const results: Array<{ telegramId: string; status: string; detail?: string }> = [];

    for (const row of due.rows) {
      const telegramId = String(row.telegram_id);
      let cycleEndsAt = Number(row.cycle_ends_at ?? 0);
      const expiresAt = Number(row.expires_at);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) continue;

      try {
        // Auto-sell also starts a fresh mining cycle when the player has not
        // opened the game and the previous cycle state is empty.
        if (!Number.isSafeInteger(cycleEndsAt) || cycleEndsAt <= 0) {
          const wallet = await db.execute({
            sql: 'SELECT oil_balance FROM player_wallets WHERE telegram_id=?',
            args: [telegramId],
          });
          const oilBalance = Number(wallet.rows[0]?.oil_balance ?? 0);
          const startAt = oilBalance > 0 ? now - CYCLE_MS : now;
          cycleEndsAt = oilBalance > 0 ? now - 1 : now + CYCLE_MS;
          const initializedCycle = await db.execute({
            sql: `UPDATE player_game_state
              SET cycle_started_at=?,cycle_ends_at=?,last_tick_at=?,updated_at=CURRENT_TIMESTAMP
              WHERE telegram_id=? AND cycle_ends_at IS NULL`,
            args: [startAt, cycleEndsAt, startAt, telegramId],
          });
          if (Number(initializedCycle.rowsAffected) !== 1) continue;
          if (oilBalance <= 0) {
            startedCycles++;
            results.push({ telegramId, status: 'cycle_started' });
            continue;
          }
        }

        if (cycleEndsAt > now) continue;
        const initData = internalInitData(telegramId, botToken);
        const tickResponse = await settleMining(internalRequest('/api/mining/action', initData, {
          action: 'tick',
          idempotencyKey: `auto-sell-tick:${telegramId}:${cycleEndsAt}`,
        }));
        const tickData = await tickResponse.json().catch(() => ({})) as { error?: string };
        if (!tickResponse.ok) {
          failedPlayers++;
          results.push({ telegramId, status: 'mining_settlement_failed', detail: tickData.error ?? String(tickResponse.status) });
          continue;
        }

        const wallet = await db.execute({
          sql: 'SELECT oil_balance FROM player_wallets WHERE telegram_id=?',
          args: [telegramId],
        });
        const oilBalance = Number(wallet.rows[0]?.oil_balance ?? 0);
        if (oilBalance > 0) {
          const saleResponse = await sellOil(internalRequest('/api/sell', initData, { idempotencyKey: randomUUID() }));
          const saleData = await saleResponse.json().catch(() => ({})) as { error?: string; sold?: number; duplicate?: boolean };
          if (!saleResponse.ok) {
            failedPlayers++;
            results.push({ telegramId, status: 'sale_failed', detail: saleData.error ?? String(saleResponse.status) });
            continue;
          }
          if (!saleData.duplicate) soldPlayers++;
        }

        // Keep the 12-hour passive cycle running while the 30-day entitlement
        // covers the next complete cycle. The normal sell endpoint handles all
        // wallet ledgers, stats, referrals, and sale notifications.
        const nextCycleEnd = cycleEndsAt + CYCLE_MS;
        if (expiresAt > nextCycleEnd) {
          const advanced = await db.execute({
            sql: `UPDATE player_game_state
              SET cycle_started_at=?,cycle_ends_at=?,last_tick_at=?,updated_at=CURRENT_TIMESTAMP
              WHERE telegram_id=? AND cycle_ends_at=?`,
            args: [cycleEndsAt, nextCycleEnd, cycleEndsAt, telegramId, cycleEndsAt],
          });
          if (Number(advanced.rowsAffected) === 1) advancedCycles++;
        } else {
          await db.execute({
            sql: `UPDATE player_game_state
              SET cycle_started_at=NULL,cycle_ends_at=NULL,last_tick_at=NULL,updated_at=CURRENT_TIMESTAMP
              WHERE telegram_id=? AND cycle_ends_at=?`,
            args: [telegramId, cycleEndsAt],
          });
        }
        results.push({ telegramId, status: oilBalance > 0 ? 'sold' : 'cycle_advanced_without_oil' });
      } catch (error) {
        failedPlayers++;
        console.error('auto_sell_player_failed', telegramId, error);
        results.push({ telegramId, status: 'failed', detail: error instanceof Error ? error.message : 'unknown_error' });
      }
    }

    return NextResponse.json({
      ok: true,
      checked: due.rows.length,
      soldPlayers,
      advancedCycles,
      startedCycles,
      failedPlayers,
      results,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('auto_sell_cron_failed', error);
    return NextResponse.json({ error: 'auto_sell_cron_failed' }, { status: 503 });
  }
}
