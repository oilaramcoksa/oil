import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { PACKAGES, UPGRADE_DURATION_MS } from '@/lib/wallets';
import { ensurePromoSchema } from '@/lib/promo-codes';

const ADMIN_SHOP_PARTS = [
  'plane_tips','auto_sell','oil_pump','fuel_station','oil_truck','new_background','vip_badge','wheel_expansion','arena_tokens_10000',
] as const;
const ADMIN_PRODUCT_NAMES: Record<string,string> = {
  fast_oil:'باقة Fast Oil', king_oil:'باقة King Oil', super_oil:'باقة Super Oil',
  plane_tips:'قطعة توصيات الطائرة', auto_sell:'البيع الآلي', oil_pump:'قطعة مضخة النفط', fuel_station:'قطعة محطة الوقود',
  oil_truck:'قطعة شاحنة النفط', new_background:'الخلفية الجديدة', vip_badge:'شارة VIP',
  wheel_expansion:'توسعة عجلة الحظ', arena_tokens_10000:'10,000 عملة للساحة',
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN ?? '';
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (token.length >= 32 && bearer.length === token.length &&
      timingSafeEqual(Buffer.from(bearer), Buffer.from(token))) return true;

  const secret = process.env.ADMIN_SESSION_SECRET ?? '';
  const value = req.cookies.get('aramco_admin')?.value ?? '';
  if (secret.length < 32 || !value || value.length > 512) return false;
  let decoded = '';
  try { decoded = Buffer.from(value, 'base64url').toString('utf8'); } catch { return false; }
  const [issued, nonce, signature, ...rest] = decoded.split('.');
  if (rest.length || !/^\d+$/.test(issued ?? '') ||
      !/^[a-f0-9]{64}$/i.test(nonce ?? '') ||
      !/^[a-f0-9]{64}$/i.test(signature ?? '')) return false;
  const timestamp = Number(issued);
  if (!Number.isSafeInteger(timestamp) || Date.now() - timestamp > 8 * 60 * 60 * 1000 ||
      timestamp > Date.now() + 60_000) return false;
  const expected = createHmac('sha256', secret).update(issued + '.' + nonce).digest('hex');
  const supplied = Buffer.from(signature, 'hex');
  const computed = Buffer.from(expected, 'hex');
  return supplied.length === computed.length && timingSafeEqual(supplied, computed);
}

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}
function noteText(value: unknown, required = false): string | null {
  const clean = typeof value === 'string' ? value.trim().slice(0, 500) : '';
  return required && !clean ? null : clean || null;
}
async function notify(
  tx: Awaited<ReturnType<ReturnType<typeof getTurso>['transaction']>>,
  telegramId: string,
  title: string,
  message: string,
  kind: string,
  meta: unknown = {},
) {
  await tx.execute({
    sql: 'INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,?,0,?,?)',
    args: [
      randomUUID(), telegramId, 'admin_notification',
      JSON.stringify({ title, message, kind, ...((meta && typeof meta === 'object') ? meta : {}) }),
      `admin-notice:${randomUUID()}`,
    ],
  });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return fail('unauthorized', 401);
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const section = req.nextUrl.searchParams.get('section') ?? 'overview';
    const status = req.nextUrl.searchParams.get('status') ?? 'pending';
    const query = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80);

    if (section === 'promos') {
      await ensurePromoSchema();
      const [codes, uses] = await Promise.all([
        db.execute('SELECT * FROM promo_codes ORDER BY created_at DESC'),
        db.execute(`SELECT r.promo_id,r.telegram_id,p.username,p.first_name,r.reward_type,r.reward_product_id,r.reward_amount,r.created_at
          FROM promo_redemptions r LEFT JOIN players p ON p.telegram_id=r.telegram_id
          ORDER BY r.created_at DESC LIMIT 200`),
      ]);
      return NextResponse.json({ promoCodes: codes.rows, promoRedemptions: uses.rows }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (section === 'notificationCounts') {
      await db.execute(`CREATE TABLE IF NOT EXISTS admin_notification_reads (
        section TEXT PRIMARY KEY,
        last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      const [players, referrals, payments, withdrawals, stories, shorts] = await Promise.all([
        db.execute(`SELECT COUNT(*) AS total FROM players
          WHERE created_at > COALESCE((SELECT last_seen_at FROM admin_notification_reads WHERE section='players'),'1970-01-01 00:00:00')`),
        db.execute(`SELECT COUNT(*) AS total FROM referrals
          WHERE created_at > COALESCE((SELECT last_seen_at FROM admin_notification_reads WHERE section='referrals'),'1970-01-01 00:00:00')`),
        db.execute("SELECT COUNT(*) AS total FROM payment_transactions WHERE status='pending'"),
        db.execute("SELECT (SELECT COUNT(*) FROM withdrawal_requests WHERE status='pending') + (SELECT COUNT(*) FROM usdt_withdrawal_requests WHERE status='pending') AS total"),
        db.execute("SELECT COUNT(*) AS total FROM telegram_story_submissions WHERE status='pending'"),
        db.execute("SELECT COUNT(*) AS total FROM shorts_entries WHERE status='pending'"),
      ]);
      const count = (result: typeof players) => Number((result.rows[0] as Record<string, unknown> | undefined)?.total ?? 0);
      return NextResponse.json({ notifications: {
        players: count(players), referrals: count(referrals), payments: count(payments),
        withdrawals: count(withdrawals), storyTasks: count(stories), shorts: count(shorts),
      } }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (section === 'overview') {
      const monthKey = new Date().toISOString().slice(0, 7);
      const [players, active, wallet, ton, usdt, payments, upgrades, ledger, monthly] = await Promise.all([
        db.execute('SELECT COUNT(*) AS total FROM players'),
        db.execute("SELECT COUNT(*) AS total FROM players WHERE status='active' AND last_seen_at >= datetime('now','-7 days')"),
        db.execute('SELECT COALESCE(SUM(coins_balance),0) AS coins, COALESCE(SUM(oil_balance),0) AS oil, COALESCE(SUM(coins_locked),0) AS locked FROM player_wallets'),
        db.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending FROM withdrawal_requests"),
        db.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending FROM usdt_withdrawal_requests"),
        db.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending FROM payment_transactions"),
        db.execute("SELECT COUNT(*) AS total FROM player_upgrades WHERE status='active' AND expires_at > CURRENT_TIMESTAMP"),
        db.execute('SELECT COUNT(*) AS total FROM ledger_entries'),
        db.execute({sql:'SELECT COUNT(*) AS players, COALESCE(SUM(coins_earned),0) AS coins_earned, COALESCE(SUM(taps),0) AS taps, COALESCE(SUM(sells),0) AS sells FROM player_monthly_stats WHERE month_key=?',args:[monthKey]}),
      ]);
      const n = (rows: Array<Record<string, unknown>>, key: string) => Number(rows[0]?.[key] ?? 0);
      return NextResponse.json({ overview: {
        players: n(players.rows as unknown as Array<Record<string, unknown>>, 'total'),
        activePlayers: n(active.rows as unknown as Array<Record<string, unknown>>, 'total'),
        coins: n(wallet.rows as unknown as Array<Record<string, unknown>>, 'coins'),
        oil: n(wallet.rows as unknown as Array<Record<string, unknown>>, 'oil'),
        lockedCoins: n(wallet.rows as unknown as Array<Record<string, unknown>>, 'locked'),
        tonPending: n(ton.rows as unknown as Array<Record<string, unknown>>, 'pending'),
        usdtPending: n(usdt.rows as unknown as Array<Record<string, unknown>>, 'pending'),
        paymentPending: n(payments.rows as unknown as Array<Record<string, unknown>>, 'pending'),
        activeUpgrades: n(upgrades.rows as unknown as Array<Record<string, unknown>>, 'total'),
        ledgerEntries: n(ledger.rows as unknown as Array<Record<string, unknown>>, 'total'),
        monthPlayers: n(monthly.rows as unknown as Array<Record<string, unknown>>, 'players'),
        monthCoinsEarned: n(monthly.rows as unknown as Array<Record<string, unknown>>, 'coins_earned'),
        monthTaps: n(monthly.rows as unknown as Array<Record<string, unknown>>, 'taps'),
        monthSales: n(monthly.rows as unknown as Array<Record<string, unknown>>, 'sells'),
      } }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (section === 'crash') {
      await db.execute(`CREATE TABLE IF NOT EXISTS admin_cancelled_crash_rounds(round_id TEXT PRIMARY KEY,reason TEXT NOT NULL,admin_id TEXT NOT NULL DEFAULT 'admin',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      const rounds = await db.execute(`SELECT r.id,r.status,r.betting_ends_at,r.started_at,r.crashed_at,r.crash_multiplier,r.seed_hash,r.created_at,c.reason AS cancellation_reason
        FROM crash_rounds r LEFT JOIN admin_cancelled_crash_rounds c ON c.round_id=r.id ORDER BY r.created_at DESC,r.rowid DESC LIMIT 100`);
      const [arenaActive,colorActive] = await Promise.all([
        db.execute(`SELECT r.id,r.status,r.created_at,COUNT(e.id) AS participants,COALESCE(SUM(e.amount),0) AS total_stakes FROM arena_rounds r LEFT JOIN arena_entries e ON e.round_id=r.id WHERE r.status IN ('open','countdown') GROUP BY r.id ORDER BY r.created_at DESC LIMIT 10`),
        db.execute(`SELECT r.id,r.status,r.created_at,COUNT(b.id) AS participants,COALESCE(SUM(b.amount),0) AS total_stakes FROM color_wheel_rounds r LEFT JOIN color_wheel_bets b ON b.round_id=r.id AND b.outcome='pending' WHERE r.status IN ('open','spinning') GROUP BY r.id ORDER BY r.created_at DESC LIMIT 10`),
      ]);
      const activeGameRounds = [
        ...(arenaActive.rows as unknown as Array<Record<string,unknown>>).map(r=>({game:'arena',id:String(r.id),status:String(r.status),createdAt:String(r.created_at),participants:Number(r.participants),totalStakes:Number(r.total_stakes)})),
        ...(colorActive.rows as unknown as Array<Record<string,unknown>>).map(r=>({game:'color_wheel',id:String(r.id),status:String(r.status),createdAt:String(r.created_at),participants:Number(r.participants),totalStakes:Number(r.total_stakes)})),
      ];
      const crashActive = await db.execute(`SELECT r.id,r.status,r.created_at,COUNT(b.id) AS participants,COALESCE(SUM(b.amount),0) AS total_stakes FROM crash_rounds r LEFT JOIN crash_bets b ON b.round_id=r.id AND b.status='active' WHERE r.status IN ('countdown','running') GROUP BY r.id ORDER BY r.created_at DESC LIMIT 10`);
      activeGameRounds.push(...(crashActive.rows as unknown as Array<Record<string,unknown>>).map(r=>({game:'crash',id:String(r.id),status:String(r.status),createdAt:String(r.created_at),participants:Number(r.participants),totalStakes:Number(r.total_stakes)})));
      const bets = await db.execute(`SELECT b.round_id,b.telegram_id,b.username,b.amount,b.status,b.cashout_multiplier,b.payout,b.created_at,
        p.first_name,p.last_name,p.username AS player_username
        FROM crash_bets b LEFT JOIN players p ON p.telegram_id=b.telegram_id
        WHERE b.round_id IN (SELECT id FROM crash_rounds ORDER BY created_at DESC,rowid DESC LIMIT 100)
        ORDER BY b.created_at ASC`);
      const grouped = new Map<string, Array<Record<string, unknown>>>();
      for (const row of bets.rows as unknown as Array<Record<string, unknown>>) {
        const key = String(row.round_id);
        const list = grouped.get(key) ?? [];
        list.push({
          telegramId: String(row.telegram_id),
          username: String(row.first_name || row.player_username || row.username || row.telegram_id),
          amount: Number(row.amount),
          status: String(row.status),
          cashoutMultiplier: row.cashout_multiplier == null ? null : Number(row.cashout_multiplier),
          payout: Number(row.payout),
          netProfit: String(row.status) === 'cashed_out' ? Number(row.payout) - Number(row.amount) : -Number(row.amount),
        });
        grouped.set(key, list);
      }
      return NextResponse.json({ activeGameRounds, crashRounds: (rounds.rows as unknown as Array<Record<string, unknown>>).map((round) => {
        const players = grouped.get(String(round.id)) ?? [];
        return {
          id: String(round.id), status: String(round.status), createdAt: String(round.created_at),
          startedAt: round.started_at == null ? null : Number(round.started_at),
          crashedAt: round.crashed_at == null ? null : Number(round.crashed_at),
          crashMultiplier: Number(round.crash_multiplier),
          participants: players.length,
          totalStakes: players.reduce((sum, player) => sum + Number(player.amount), 0),
          winners: players.filter((player) => player.status === 'cashed_out'),
          players,
          seedHash: String(round.seed_hash), cancellationReason: round.cancellation_reason == null ? null : String(round.cancellation_reason),
        };
      }) }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (section === 'playerProducts') {
      const playerId = req.nextUrl.searchParams.get('telegramId') ?? '';
      if (!playerId || playerId.length > 64) return fail('player_required');
      await db.execute(`CREATE TABLE IF NOT EXISTS player_product_controls (
        id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
        product_id TEXT NOT NULL, product_type TEXT NOT NULL CHECK(product_type IN ('part','package')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','revoked')),
        speed_multiplier REAL NOT NULL DEFAULT 1 CHECK(speed_multiplier >= 0 AND speed_multiplier <= 100),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(telegram_id,product_id,product_type)
      )`);
      const rows = await db.execute({sql:`SELECT u.id AS purchase_id,u.package_id AS product_id,'package' AS product_type,
        u.purchased_at AS purchased_at,u.expires_at AS expires_at,u.status AS purchase_status,
        COALESCE(c.status,'active') AS control_status,COALESCE(c.speed_multiplier,1) AS speed_multiplier,
        p.amount AS amount,p.asset AS asset,p.tx_hash AS tx_hash
        FROM player_upgrades u LEFT JOIN player_product_controls c ON c.telegram_id=u.telegram_id AND c.product_id=u.package_id AND c.product_type='package'
        LEFT JOIN payment_transactions p ON p.id=u.payment_id WHERE u.telegram_id=?
        UNION ALL
        SELECT p.id AS purchase_id,p.package_id AS product_id,'part' AS product_type,p.created_at AS purchased_at,
        NULL AS expires_at,p.status AS purchase_status,COALESCE(c.status,'active') AS control_status,
        COALESCE(c.speed_multiplier,1) AS speed_multiplier,p.amount AS amount,p.asset AS asset,p.tx_hash AS tx_hash
        FROM payment_transactions p LEFT JOIN player_product_controls c ON c.telegram_id=p.telegram_id AND c.product_id=p.package_id AND c.product_type='part'
        WHERE p.telegram_id=? AND p.status='confirmed' AND p.provider='tonconnect_auto'
          AND json_extract(p.provider_payload_json,'$.kind')='shop_part'
        ORDER BY purchased_at DESC`,args:[playerId,playerId]});
      return NextResponse.json({products:rows.rows},{headers:{'Cache-Control':'no-store'}});
    }

    if (section === 'playerBalanceHistory') {
      const playerId = (req.nextUrl.searchParams.get('telegramId') ?? '').trim();
      const asset = req.nextUrl.searchParams.get('asset') ?? '';
      if (!/^\\d{1,24}$/.test(playerId) || !['coins','oil','usd'].includes(asset)) return fail('invalid_balance_history_request');
      const [player, ledger] = await Promise.all([
        db.execute({
          sql: `SELECT p.telegram_id,p.username,p.first_name,p.last_name,
            COALESCE(w.coins_balance,0) AS coins_balance,COALESCE(w.coins_locked,0) AS coins_locked,
            COALESCE(w.oil_balance,0) AS oil_balance,COALESCE(w.usd_micros,0) AS usd_micros, COALESCE(w.usd_locked_micros,0) AS usd_locked_micros,
            COALESCE(w.usd_locked_micros,0) AS usd_locked_micros
            FROM players p LEFT JOIN player_wallets w ON w.telegram_id=p.telegram_id
            WHERE p.telegram_id=? LIMIT 1`,
          args: [playerId],
        }),
        asset === 'usd'
          ? Promise.resolve(null)
          : db.execute({
              sql: `SELECT id,asset,entry_type,amount,balance_after,reference_type,reference_id,metadata_json,created_at
                FROM ledger_entries WHERE telegram_id=? AND asset=?
                ORDER BY created_at DESC,rowid DESC LIMIT 300`,
              args: [playerId, asset],
            }),
      ]);
      if (!player.rows.length) return fail('player_not_found',404);
      let entries: Array<Record<string, unknown>> = [];
      if (asset === 'usd') {
        const [swaps, withdrawals] = await Promise.all([
          db.execute({sql:'SELECT id,coins,usd_micros,created_at FROM coin_swaps WHERE telegram_id=? ORDER BY created_at DESC LIMIT 300',args:[playerId]}),
          db.execute({sql:'SELECT id,usd_micros,status,tron_address,tx_hash,admin_note,created_at,updated_at FROM usdt_withdrawal_requests WHERE telegram_id=? ORDER BY created_at DESC LIMIT 300',args:[playerId]}),
        ]);
        for (const row of swaps.rows as unknown as Array<Record<string,unknown>>) {
          entries.push({
            id:String(row.id),asset:'usd',entryType:'coin_swap_credit',amountMicros:Number(row.usd_micros),
            coinsConverted:Number(row.coins),referenceType:'coin_swap',referenceId:String(row.id),
            metadata:{coins:Number(row.coins),usdMicros:Number(row.usd_micros),rate:'1000 micro-USD per coin'},
            createdAt:String(row.created_at),status:'completed',
          });
        }
        for (const row of withdrawals.rows as unknown as Array<Record<string,unknown>>) {
          const micros=Number(row.usd_micros);
          const metadata={tronAddress:String(row.tron_address),txHash:row.tx_hash??null,adminNote:row.admin_note??null};
          entries.push({
            id:String(row.id)+':debit',asset:'usd',entryType:'usdt_withdrawal',amountMicros:-micros,
            referenceType:'usdt_withdrawal',referenceId:String(row.id),metadata,
            createdAt:String(row.created_at),status:String(row.status),
          });
          if(String(row.status)==='rejected') entries.push({
            id:String(row.id)+':refund',asset:'usd',entryType:'usdt_withdrawal_refund',amountMicros:micros,
            referenceType:'usdt_withdrawal',referenceId:String(row.id),
            metadata:{...metadata,reason:String(row.admin_note??'')},
            createdAt:String(row.updated_at),status:'refunded',
          });
        }
        entries.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
        entries = entries.slice(0,300);
      } else {
        entries = (ledger?.rows ?? []).map((row) => ({
          id:String(row.id),asset:String(row.asset),entryType:String(row.entry_type),
          amount:Number(row.amount),balanceAfter:Number(row.balance_after),
          referenceType:row.reference_type==null?null:String(row.reference_type),
          referenceId:row.reference_id==null?null:String(row.reference_id),
          metadata:(()=>{try{return row.metadata_json?JSON.parse(String(row.metadata_json)):null;}catch{return {raw:String(row.metadata_json)};}})(),
          createdAt:String(row.created_at),
        }));
      }
      const row=player.rows[0] as Record<string,unknown>;
      return NextResponse.json({
        player:{telegramId:String(row.telegram_id),name:String(row.first_name||row.username||row.telegram_id)},
        asset,
        wallet:{
          coins:Number(row.coins_balance),coinsLocked:Number(row.coins_locked),
          oil:Number(row.oil_balance),usdMicros:Number(row.usd_micros),usdLockedMicros:Number(row.usd_locked_micros),
        },
        entries,
        limit:300,
      },{headers:{'Cache-Control':'no-store, private'}});
    }

    if (section === 'players') {
      const like = `%${query.replace(/[%_]/g, '')}%`;
      const rows = await db.execute({
        sql: `SELECT p.telegram_id,p.username,p.first_name,p.last_name,p.status,p.created_at,p.last_seen_at,
                     COALESCE(w.coins_balance,0) AS coins,COALESCE(w.oil_balance,0) AS oil,
                     COALESCE(w.usd_micros,0) AS usd_micros,
                     COALESCE(g.base_oil_per_tap,2) AS base_oil_per_tap,
                     COALESCE(g.base_capacity,500) AS base_capacity,
                     COALESCE(p.fee_exempt,0) AS fee_exempt,p.mining_fee_paid_at
              FROM players p
              LEFT JOIN player_wallets w ON w.telegram_id=p.telegram_id
              LEFT JOIN player_game_state g ON g.telegram_id=p.telegram_id
              WHERE (?='' OR p.telegram_id LIKE ? OR COALESCE(p.username,'') LIKE ? OR COALESCE(p.first_name,'') LIKE ? OR COALESCE(p.last_name,'') LIKE ?)
              ORDER BY p.last_seen_at DESC LIMIT 250`,
        args: [query, like, like, like, like],
      });
      return NextResponse.json({ players: rows.rows }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (section === 'withdrawals') {
      const [ton, usdt] = await Promise.all([
        db.execute({
          sql: `SELECT w.*,p.username,p.first_name FROM withdrawal_requests w
                JOIN players p ON p.telegram_id=w.telegram_id
                WHERE (?='all' OR w.status=?) ORDER BY w.created_at DESC LIMIT 200`,
          args: [status, status],
        }),
        db.execute({
          sql: `SELECT w.*,p.username,p.first_name FROM usdt_withdrawal_requests w
                JOIN players p ON p.telegram_id=w.telegram_id
                WHERE (?='all' OR w.status=?) ORDER BY w.created_at DESC LIMIT 200`,
          args: [status, status],
        }),
      ]);
      return NextResponse.json({ ton: ton.rows, usdt: usdt.rows }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (section === 'payments') {
      const rows = await db.execute({
        sql: `SELECT p.*,u.username,u.first_name FROM payment_transactions p
              JOIN players u ON u.telegram_id=p.telegram_id
              WHERE (?='all' OR p.status=?) ORDER BY p.created_at DESC LIMIT 200`,
        args: [status, status],
      });
      return NextResponse.json({ payments: rows.rows }, { headers: { 'Cache-Control': 'no-store' } });
    }


    if (section === 'referrals') {
      const rows = await db.execute({
        sql: `SELECT r.id,r.referrer_telegram_id,r.referee_telegram_id,r.status,r.reward_coins,r.created_at,
                     a.username AS referrer_username,a.first_name AS referrer_name,
                     b.username AS referee_username,b.first_name AS referee_name
              FROM referrals r
              JOIN players a ON a.telegram_id=r.referrer_telegram_id
              JOIN players b ON b.telegram_id=r.referee_telegram_id
              ORDER BY r.created_at DESC LIMIT 500`,
      });
      return NextResponse.json({ referrals: rows.rows }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (section === 'broadcasts') {
      const rows = await db.execute({
        sql: "SELECT id,action,target_type,target_id,details_json,created_at FROM admin_audit_logs WHERE action='broadcast' ORDER BY created_at DESC LIMIT 100",
      });
      return NextResponse.json({ broadcasts: rows.rows }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (section === 'storyTasks') {
      const rows = await db.execute({
        sql: `SELECT s.*,p.username,p.first_name,p.last_name
              FROM telegram_story_submissions s
              JOIN players p ON p.telegram_id=s.telegram_id
              WHERE (?='all' OR s.status=?)
              ORDER BY CASE WHEN s.status='pending' THEN 0 ELSE 1 END,s.submitted_at DESC
              LIMIT 500`,
        args: [status, status],
      });
      return NextResponse.json({ storyTasks: rows.rows }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (section === 'shorts') {
      await db.execute(`CREATE TABLE IF NOT EXISTS shorts_contest (
        id TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','cancelled')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      try { await db.execute("ALTER TABLE shorts_contest ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','cancelled'))"); } catch { /* Column already exists. */ }
      await db.execute("INSERT OR IGNORE INTO shorts_contest(id,starts_at,ends_at) VALUES('main',?,?)", [Date.now(), Date.now()+60*24*60*60*1000]);
      await db.execute(`CREATE TABLE IF NOT EXISTS shorts_entries (
        id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
        video_url TEXT NOT NULL UNIQUE, video_title TEXT NOT NULL DEFAULT '', declared_views INTEGER NOT NULL DEFAULT 0,
        previous_rank INTEGER, status TEXT NOT NULL DEFAULT 'approved', last_reported_at INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      const rows = await db.execute(`SELECT e.*,p.username,p.first_name FROM shorts_entries e
        JOIN players p ON p.telegram_id=e.telegram_id
        WHERE (?='all' OR e.status=?) ORDER BY CASE WHEN e.status='pending' THEN 0 ELSE 1 END,e.declared_views DESC,e.created_at ASC LIMIT 500`, [status,status]);
      const contest = await db.execute("SELECT starts_at,ends_at,status FROM shorts_contest WHERE id='main'");
      return NextResponse.json({ shorts: rows.rows, contest: contest.rows[0] ?? null }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (section === 'audit') {
      const rows = await db.execute('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 150');
      return NextResponse.json({ logs: rows.rows }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return fail('unknown_section', 404);
  } catch (error) {
    console.error('admin_api_get_failed', error);
    return fail('database_unavailable', 503);
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return fail('unauthorized', 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail('invalid_body'); }

  const action = String(body.action ?? '');
  const target = String(body.telegramId ?? '').trim().slice(0, 64);
  const reason = noteText(body.reason, true);
  const amount = Number(body.amount);
  let broadcastDelivered: number | null = null;

  if (['grant_coins', 'grant_oil', 'set_speed', 'ban', 'unban', 'product_control', 'grant_product'].includes(action) && !target) return fail('player_required');
  if (['grant_coins', 'grant_oil'].includes(action) &&
      (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000)) return fail('invalid_amount');
  if (action === 'grant_coins' && !reason) return fail('reason_required');
  if (action === 'grant_product') {
    const productId = String(body.productId ?? '');
    const quantity = Number(body.quantity ?? 1);
    if ((!ADMIN_SHOP_PARTS.includes(productId as typeof ADMIN_SHOP_PARTS[number]) && !PACKAGES.some((p) => p.id === productId)) ||
        !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100 || (!ADMIN_SHOP_PARTS.includes(productId as typeof ADMIN_SHOP_PARTS[number]) && quantity !== 1)) return fail('invalid_product_grant');
    if (!reason) return fail('reason_required');
  }
  if (action === 'set_speed' &&
      (!Number.isSafeInteger(Number(body.speed)) || Number(body.speed) < 1 || Number(body.speed) > 1_000_000)) return fail('invalid_speed');
  if (action === 'set_mining_fee_exemption' && !['0','1'].includes(String(body.exempt))) return fail('invalid_exemption_value');

  try {
    await ensureDatabaseSchema();
    await ensurePromoSchema();
    const db = getTurso();
    const tx = await db.transaction('write');
    try {
      if (action === 'promo_save') {
        const id = String(body.id ?? randomUUID()).slice(0,64);
        const code = String(body.code ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,40);
        const type = String(body.promoType ?? '');
        const productId = String(body.productId ?? '').trim().slice(0,80) || null;
        const rewardCoins = Math.floor(Number(body.rewardCoins ?? 0));
        const perUserLimit = Math.floor(Number(body.perUserLimit ?? 1));
        const totalLimit = body.totalLimit === '' || body.totalLimit == null ? null : Math.floor(Number(body.totalLimit));
        const active = body.active === false || String(body.active)==='0' ? 0 : 1;
        const startsAt = String(body.startsAt ?? '').trim() || null;
        const expiresAt = String(body.expiresAt ?? '').trim() || null;
        if (!/^[A-Z0-9_-]{3,40}$/.test(code) || !['mining_fee','free_part','free_package','coins'].includes(type) ||
            !Number.isSafeInteger(perUserLimit) || perUserLimit<1 || perUserLimit>10000 ||
            (totalLimit!==null && (!Number.isSafeInteger(totalLimit)||totalLimit<1)) ||
            (type==='coins' && (!Number.isSafeInteger(rewardCoins)||rewardCoins<1||rewardCoins>1000000000)) ||
            ((type==='free_part'||type==='free_package') && !productId)) {
          await tx.rollback(); return fail('invalid_promo_configuration');
        }
        if (type==='free_part' && productId!=='any' && !ADMIN_SHOP_PARTS.includes(productId as typeof ADMIN_SHOP_PARTS[number])) { await tx.rollback(); return fail('invalid_promo_product'); }
        if (type==='free_package' && productId!=='any' && !PACKAGES.some(p=>p.id===productId)) { await tx.rollback(); return fail('invalid_promo_product'); }
        const duplicate=await tx.execute({sql:'SELECT id FROM promo_codes WHERE code=? COLLATE NOCASE AND id<>? LIMIT 1',args:[code,id]});
        if(duplicate.rows.length){await tx.rollback();return fail('promo_code_already_exists',409);}
        await tx.execute({sql:`INSERT INTO promo_codes(id,code,promo_type,product_id,reward_coins,per_user_limit,total_limit,starts_at,expires_at,active)
          VALUES(?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET code=excluded.code,promo_type=excluded.promo_type,product_id=excluded.product_id,
          reward_coins=excluded.reward_coins,per_user_limit=excluded.per_user_limit,total_limit=excluded.total_limit,
          starts_at=excluded.starts_at,expires_at=excluded.expires_at,active=excluded.active,updated_at=CURRENT_TIMESTAMP`,
          args:[id,code,type,productId,rewardCoins,perUserLimit,totalLimit,startsAt,expiresAt,active]});
        await tx.execute({sql:'INSERT INTO admin_audit_logs(id,admin_id,action,target_type,target_id,details_json) VALUES(?,?,?,?,?,?)',
          args:[randomUUID(),'admin','promo_save','promo',id,JSON.stringify({code,type,productId,rewardCoins,perUserLimit,totalLimit,active})]});
      } else if (action === 'promo_toggle' || action === 'promo_delete') {
        const id=String(body.id??'').slice(0,64);
        if(!id){await tx.rollback();return fail('promo_id_required');}
        if(action==='promo_toggle'){
          await tx.execute({sql:'UPDATE promo_codes SET active=CASE WHEN active=1 THEN 0 ELSE 1 END,updated_at=CURRENT_TIMESTAMP WHERE id=?',args:[id]});
        }else{
          const uses=await tx.execute({sql:'SELECT COUNT(*) AS n FROM promo_redemptions WHERE promo_id=?',args:[id]});
          if(Number(uses.rows[0]?.n??0)>0){await tx.execute({sql:'UPDATE promo_codes SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?',args:[id]});}
          else{await tx.execute({sql:'DELETE FROM promo_codes WHERE id=?',args:[id]});}
        }
        await tx.execute({sql:'INSERT INTO admin_audit_logs(id,admin_id,action,target_type,target_id,details_json) VALUES(?,?,?,?,?,?)',
          args:[randomUUID(),'admin',action,'promo',id,JSON.stringify({safeDelete:true})]});
      } else if (action === 'mark_notifications_read') {
        const section = String(body.section ?? '');
        if (!['players','referrals'].includes(section)) { await tx.rollback(); return fail('invalid_notification_section'); }
        await tx.execute(`CREATE TABLE IF NOT EXISTS admin_notification_reads (
          section TEXT PRIMARY KEY,
          last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);
        await tx.execute({
          sql: 'INSERT INTO admin_notification_reads(section,last_seen_at) VALUES(?,CURRENT_TIMESTAMP) ON CONFLICT(section) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP',
          args: [section],
        });
        await tx.commit();
        return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (['promo_save','promo_toggle','promo_delete'].includes(action)) {
        await tx.commit();
        return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
      }

      if (action === 'cancel_game_round') {
        const game=String(body.game??'');
        const roundId=String(body.roundId??'').trim().slice(0,64);
        const cancelReason=noteText(body.reason,true);
        if(!['arena','color_wheel','crash'].includes(game)||!roundId||!cancelReason){await tx.rollback();return fail('invalid_round_cancellation');}
        let refundedPlayers=0,refundedCoins=0,refundedBetTokens=0;
        if(game==='arena'){
          const round=await tx.execute({sql:"UPDATE arena_rounds SET status='cancelled',completed_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('open','countdown') RETURNING id",args:[roundId]});
          if(!round.rows.length){await tx.rollback();return fail('round_not_cancellable',409);}
          const entries=await tx.execute({sql:'SELECT telegram_id,amount,purchased_amount,wallet_amount FROM arena_entries WHERE round_id=?',args:[roundId]});
          for(const e of entries.rows){
            const pid=String(e.telegram_id), purchased=Number(e.purchased_amount??0), wallet=Number(e.wallet_amount??0)||(purchased===0?Number(e.amount):0);
            if(purchased>0){
              const b=await tx.execute({sql:'INSERT INTO bet_token_balances(telegram_id,balance) VALUES(?,?) ON CONFLICT(telegram_id) DO UPDATE SET balance=balance+excluded.balance,updated_at=CURRENT_TIMESTAMP RETURNING balance',args:[pid,purchased]});
              await tx.execute({sql:"INSERT INTO bet_token_transactions(id,telegram_id,transaction_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'refund',?,?, 'arena_round',?,?,?)",args:[randomUUID(),pid,purchased,Number(b.rows[0].balance),roundId,`admin_arena_refund:${roundId}:${pid}`,JSON.stringify({reason:cancelReason,source:'admin'})]});
              refundedBetTokens+=purchased;
            }
            if(wallet>0){
              const b=await tx.execute({sql:'UPDATE player_wallets SET coins_balance=coins_balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? RETURNING coins_balance',args:[wallet,pid]});
              if(!b.rows.length)throw new Error('wallet_missing_for_refund');
              await tx.execute({sql:"INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','arena_refund',?,?, 'arena_round',?,?,?)",args:[randomUUID(),pid,wallet,Number(b.rows[0].coins_balance),roundId,`admin_arena_refund_wallet:${roundId}:${pid}`,JSON.stringify({reason:cancelReason,source:'admin'})]});
              refundedCoins+=wallet;
            }
            if(purchased+wallet>0)refundedPlayers++;
          }
        } else if(game==='color_wheel'){
          const round=await tx.execute({sql:"UPDATE color_wheel_rounds SET status='completed',winning_color='admin_cancelled',completed_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('open','spinning') RETURNING id",args:[roundId]});
          if(!round.rows.length){await tx.rollback();return fail('round_not_cancellable',409);}
          const bets=await tx.execute({sql:"SELECT telegram_id,amount,purchased_amount,wallet_amount FROM color_wheel_bets WHERE round_id=? AND outcome='pending'",args:[roundId]});
          for(const b of bets.rows){
            const pid=String(b.telegram_id),purchased=Number(b.purchased_amount??0),wallet=Number(b.wallet_amount??0)||(purchased===0?Number(b.amount):0);
            if(purchased>0){
              const bal=await tx.execute({sql:'INSERT INTO bet_token_balances(telegram_id,balance) VALUES(?,?) ON CONFLICT(telegram_id) DO UPDATE SET balance=balance+excluded.balance,updated_at=CURRENT_TIMESTAMP RETURNING balance',args:[pid,purchased]});
              await tx.execute({sql:"INSERT INTO bet_token_transactions(id,telegram_id,transaction_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'refund',?,?, 'color_wheel_round',?,?,?)",args:[randomUUID(),pid,purchased,Number(bal.rows[0].balance),roundId,`admin_color_refund_tokens:${roundId}:${pid}`,JSON.stringify({reason:cancelReason,source:'admin'})]});
              refundedBetTokens+=purchased;
            }
            if(wallet>0){
              const bal=await tx.execute({sql:'UPDATE player_wallets SET coins_balance=coins_balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? RETURNING coins_balance',args:[wallet,pid]});
              if(!bal.rows.length)throw new Error('wallet_missing_for_refund');
              await tx.execute({sql:"INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','color_wheel_refund',?,?, 'color_wheel_round',?,?,?)",args:[randomUUID(),pid,wallet,Number(bal.rows[0].coins_balance),roundId,`admin_color_refund_wallet:${roundId}:${pid}`,JSON.stringify({reason:cancelReason,source:'admin'})]});
              refundedCoins+=wallet;
            }
            await tx.execute({sql:"UPDATE color_wheel_bets SET outcome='loss',payout=0 WHERE round_id=? AND telegram_id=? AND outcome='pending'",args:[roundId,pid]});
            if(purchased+wallet>0)refundedPlayers++;
          }
        } else {
          await tx.execute(`CREATE TABLE IF NOT EXISTS admin_cancelled_crash_rounds(
            round_id TEXT PRIMARY KEY,reason TEXT NOT NULL,admin_id TEXT NOT NULL DEFAULT 'admin',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`);
          const round=await tx.execute({sql:"UPDATE crash_rounds SET status='crashed',crashed_at=? WHERE id=? AND status IN ('countdown','running') RETURNING id",args:[Date.now(),roundId]});
          if(!round.rows.length){await tx.rollback();return fail('round_not_cancellable',409);}
          const bets=await tx.execute({sql:"SELECT telegram_id,amount,purchased_amount,wallet_amount FROM crash_bets WHERE round_id=? AND status='active'",args:[roundId]});
          for(const b of bets.rows){
            const pid=String(b.telegram_id),purchased=Number(b.purchased_amount??0),wallet=Number(b.wallet_amount??0);
            if(purchased>0){
              const bal=await tx.execute({sql:'INSERT INTO bet_token_balances(telegram_id,balance) VALUES(?,?) ON CONFLICT(telegram_id) DO UPDATE SET balance=balance+excluded.balance,updated_at=CURRENT_TIMESTAMP RETURNING balance',args:[pid,purchased]});
              await tx.execute({sql:"INSERT INTO bet_token_transactions(id,telegram_id,transaction_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'refund',?,?, 'crash_round',?,?,?)",args:[randomUUID(),pid,purchased,Number(bal.rows[0].balance),roundId,`admin_crash_refund_tokens:${roundId}:${pid}`,JSON.stringify({reason:cancelReason,source:'admin'})]});
              refundedBetTokens+=purchased;
            }
            if(wallet>0){
              const bal=await tx.execute({sql:'UPDATE player_wallets SET coins_balance=coins_balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? RETURNING coins_balance',args:[wallet,pid]});
              if(!bal.rows.length)throw new Error('wallet_missing_for_refund');
              await tx.execute({sql:"INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','crash_refund',?,?, 'crash_round',?,?,?)",args:[randomUUID(),pid,wallet,Number(bal.rows[0].coins_balance),roundId,`admin_crash_refund_wallet:${roundId}:${pid}`,JSON.stringify({reason:cancelReason,source:'admin'})]});
              refundedCoins+=wallet;
            }
            await tx.execute({sql:"UPDATE crash_bets SET status='lost',settled_at=CURRENT_TIMESTAMP WHERE round_id=? AND telegram_id=? AND status='active'",args:[roundId,pid]});
            if(purchased+wallet>0)refundedPlayers++;
          }
          await tx.execute({sql:'INSERT INTO admin_cancelled_crash_rounds(round_id,reason) VALUES(?,?)',args:[roundId,cancelReason]});
        }
        await tx.execute({sql:'INSERT INTO admin_audit_logs(id,admin_id,action,target_type,target_id,details_json) VALUES(?,?,?,?,?,?)',args:[randomUUID(),'admin_session','cancel_game_round',game,roundId,JSON.stringify({reason:cancelReason,refundedPlayers,refundedCoins,refundedBetTokens})]});
        await tx.commit();
        return NextResponse.json({ok:true,refundedPlayers,refundedCoins,refundedBetTokens},{headers:{'Cache-Control':'no-store'}});
      }

      if (action === 'adjust_balance') {
        const asset=String(body.asset??'');
        const delta=Number(body.amount);
        const adjustmentReason=noteText(body.reason,true);
        if(!['coins','oil','usd'].includes(asset)||!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>1_000_000_000_000||!adjustmentReason){await tx.rollback();return fail('invalid_balance_adjustment');}
        const exists=await tx.execute({sql:'SELECT telegram_id FROM players WHERE telegram_id=?',args:[target]});
        if(!exists.rows.length){await tx.rollback();return fail('player_not_found',404);}
        await tx.execute({sql:'INSERT OR IGNORE INTO player_wallets(telegram_id) VALUES(?)',args:[target]});
        const column=asset==='coins'?'coins_balance':asset==='oil'?'oil_balance':'usd_micros';
        const before=await tx.execute({sql:'SELECT '+column+' AS balance FROM player_wallets WHERE telegram_id=?',args:[target]});
        const oldBalance=Number(before.rows[0]?.balance??0),newBalance=oldBalance+delta;
        if(newBalance<0){await tx.rollback();return fail('balance_cannot_be_negative',409);}
        const update=await tx.execute({sql:'UPDATE player_wallets SET '+column+'=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',args:[newBalance,target]});
        if(Number(update.rowsAffected)!==1)throw new Error('balance_adjustment_failed');
        const referenceId=randomUUID();
        if(asset==='coins'||asset==='oil'){
          await tx.execute({sql:'INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?)',args:[randomUUID(),target,asset,'admin_adjustment',delta,newBalance,'admin',referenceId,`admin-adjust:${asset}:${referenceId}`,JSON.stringify({reason:adjustmentReason,source:'admin_panel'})]});
        } else {
          await tx.execute(`CREATE TABLE IF NOT EXISTS admin_balance_adjustments(
            id TEXT PRIMARY KEY,telegram_id TEXT NOT NULL,asset TEXT NOT NULL,amount INTEGER NOT NULL,balance_after INTEGER NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`);
          await tx.execute({sql:'INSERT INTO admin_balance_adjustments(id,telegram_id,asset,amount,balance_after,reason) VALUES(?,?,?,?,?,?)',args:[referenceId,target,'usd',delta,newBalance,adjustmentReason]});
        }
        await tx.execute({sql:'INSERT INTO admin_audit_logs(id,admin_id,action,target_type,target_id,details_json) VALUES(?,?,?,?,?,?)',args:[randomUUID(),'admin_session','adjust_balance',asset,target,JSON.stringify({delta,balanceBefore:oldBalance,balanceAfter:newBalance,reason:adjustmentReason,usdUnit:asset==='usd'?'micro-USD':null})]});
        await tx.commit();
        return NextResponse.json({ok:true,asset,balance:newBalance},{headers:{'Cache-Control':'no-store'}});
      }

      if (action === 'grant_product') {
        const productId = String(body.productId);
        const quantity = Number(body.quantity ?? 1);
        const player = await tx.execute({ sql: 'SELECT telegram_id FROM players WHERE telegram_id=?', args: [target] });
        if (!player.rows.length) { await tx.rollback(); return fail('player_not_found', 404); }
        await tx.execute(`CREATE TABLE IF NOT EXISTS player_product_controls (
          id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
          product_id TEXT NOT NULL, product_type TEXT NOT NULL CHECK(product_type IN ('part','package')),
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','revoked')),
          speed_multiplier REAL NOT NULL DEFAULT 1 CHECK(speed_multiplier >= 0 AND speed_multiplier <= 100),
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(telegram_id,product_id,product_type)
        )`);
        const grantId = randomUUID();
        const isPackage = PACKAGES.some((p) => p.id === productId);
        if (isPackage) {
          const now = Date.now();
          await tx.execute({ sql: "INSERT INTO player_upgrades(id,telegram_id,package_id,payment_id,purchased_at,expires_at,status) VALUES(?,?,?,NULL,?,?,'active')", args: [grantId,target,productId,new Date(now).toISOString(),new Date(now+UPGRADE_DURATION_MS).toISOString()] });
        } else if (productId === 'arena_tokens_10000') {
          const credit = await tx.execute({ sql: 'INSERT INTO bet_token_balances(telegram_id,balance) VALUES(?,?) ON CONFLICT(telegram_id) DO UPDATE SET balance=balance+excluded.balance,updated_at=CURRENT_TIMESTAMP RETURNING balance', args: [target,10000*quantity] });
          await tx.execute({ sql: "INSERT INTO bet_token_transactions(id,telegram_id,transaction_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'purchase',?,?, 'admin',?,?,?)", args: [grantId,target,10000*quantity,Number(credit.rows[0]?.balance ?? 0),grantId,`admin-product:${grantId}`,JSON.stringify({productId,quantity,reason,source:'admin_panel'})] });
        } else if (['oil_pump','fuel_station','oil_truck'].includes(productId)) {
          await tx.execute({ sql: 'INSERT INTO player_parts(telegram_id,part_id,quantity) VALUES(?,?,?) ON CONFLICT(telegram_id,part_id) DO UPDATE SET quantity=quantity+excluded.quantity,updated_at=CURRENT_TIMESTAMP', args: [target,productId,quantity] });
        } else {
          await tx.execute(`CREATE TABLE IF NOT EXISTS player_special_parts (
            telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
            part_id TEXT NOT NULL, purchased_at INTEGER NOT NULL, expires_at INTEGER,
            payment_id TEXT NOT NULL UNIQUE, usage_count INTEGER NOT NULL DEFAULT 0 CHECK(usage_count >= 0),
            PRIMARY KEY(telegram_id,part_id,payment_id)
          )`);
          for (let i=0;i<quantity;i++) {
            const now = Date.now();
            await tx.execute({ sql: 'INSERT INTO player_special_parts(telegram_id,part_id,purchased_at,expires_at,payment_id,usage_count) VALUES(?,?,?,?,?,0)', args: [target,productId,now,productId==='wheel_expansion'?now+72*60*60*1000:productId==='auto_sell'?now+30*24*60*60*1000:null,randomUUID()] });
          }
        }
        if (productId !== 'arena_tokens_10000') {
          await tx.execute({ sql: "INSERT INTO player_product_controls(id,telegram_id,product_id,product_type,status,speed_multiplier) VALUES(?,?,?,?,'active',1) ON CONFLICT(telegram_id,product_id,product_type) DO UPDATE SET status='active',speed_multiplier=1,updated_at=CURRENT_TIMESTAMP", args: [randomUUID(),target,productId,isPackage?'package':'part'] });
        }
        const productName = ADMIN_PRODUCT_NAMES[productId] ?? productId;
        await tx.execute({ sql: 'INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,?,?,?,?)', args: [randomUUID(),target,'admin_product_grant',isPackage?1:quantity,JSON.stringify({productId,quantity,reason,grantId}),`admin-product-event:${grantId}`] });
        await notify(tx,target,'🎁 هدية من إدارة ARMCO OIL',`منحتك الإدارة ${quantity>1?quantity+' × ':''}${productName} مجانًا. السبب: ${reason}`,'reward',{productId,quantity,reason,source:'admin_panel'});
      } else if (action === 'product_control') {
        const productId = String(body.productId ?? '').trim();
        const productType = String(body.productType ?? '');
        const operation = String(body.operation ?? '');
        const multiplier = Number(body.speedMultiplier ?? 1);
        if (!target || !productId || !['part','package'].includes(productType) ||
            !['activate','pause','revoke','speed'].includes(operation) ||
            (operation === 'speed' && (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 100))) {
          await tx.rollback(); return fail('invalid_product_control');
        }
        const status = operation === 'pause' ? 'paused' : operation === 'revoke' ? 'revoked' : 'active';
        await tx.execute({
          sql: `INSERT INTO player_product_controls(id,telegram_id,product_id,product_type,status,speed_multiplier)
            VALUES(?,?,?,?,?,?) ON CONFLICT(telegram_id,product_id,product_type) DO UPDATE SET
            status=excluded.status,speed_multiplier=CASE WHEN ?='speed' THEN excluded.speed_multiplier ELSE player_product_controls.speed_multiplier END,
            updated_at=CURRENT_TIMESTAMP`,
          args: [randomUUID(),target,productId,productType,status,multiplier,operation],
        });
        if (productType === 'package' && operation === 'revoke') {
          await tx.execute({
            sql: "UPDATE player_upgrades SET status='revoked' WHERE telegram_id=? AND package_id=? AND status='active'",
            args: [target,productId],
          });
        }
        await notify(tx,target,'تحديث على منتجك في ARMCO OIL',
          operation==='pause'?'تم إيقاف المنتج مؤقتًا بواسطة الإدارة.':operation==='revoke'?'تم إلغاء تفعيل المنتج بواسطة الإدارة.':operation==='speed'? 'تم تعديل سرعة المنتج بواسطة الإدارة.':'تمت إعادة تفعيل المنتج.',
          'product',{productId,productType,operation,speedMultiplier:multiplier});
      } else if (action === 'set_mining_fee_exemption') {
        const exists = await tx.execute({ sql: 'SELECT telegram_id FROM players WHERE telegram_id=?', args: [target] });
        if (!exists.rows.length) { await tx.rollback(); return fail('player_not_found', 404); }
        const exempt = String(body.exempt) === '1' ? 1 : 0;
        await tx.execute({
          sql: 'UPDATE players SET fee_exempt=? WHERE telegram_id=?',
          args: [exempt, target],
        });
        await notify(tx, target,
          exempt ? '🎁 تم إعفاؤك من رسوم تفعيل التعدين' : 'رسوم تفعيل التعدين',
          exempt ? 'قامت الإدارة بإعفاء حسابك من رسوم تفعيل التعدين. يمكنك بدء التعدين دون دفع الرسوم.' : 'ألغت الإدارة إعفاء رسوم التعدين لهذا الحساب. يلزم إتمام رسوم التفعيل قبل بدء التعدين إذا لم تكن قد دفعتها سابقًا.',
          'account', { feeExempt: !!exempt, reason: reason || 'إجراء إداري' });
      } else if (action === 'mining_fee_settings') {
        const enabled = body.enabled === true ? '1' : '0';
        await tx.execute({
          sql: "INSERT INTO app_settings(setting_key,setting_value) VALUES('mining_fee_enabled',?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
          args: [enabled],
        });
      } else if (action === 'shorts_contest') {
        const operation = String(body.operation ?? '');
        if (!['pause','cancel','activate','extend'].includes(operation)) { await tx.rollback(); return fail('invalid_contest_operation'); }
        await tx.execute(`CREATE TABLE IF NOT EXISTS shorts_contest (
          id TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','cancelled')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);
        try { await tx.execute("ALTER TABLE shorts_contest ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','cancelled'))"); } catch { /* Column already exists. */ }
        await tx.execute({ sql: "INSERT OR IGNORE INTO shorts_contest(id,starts_at,ends_at) VALUES('main',?,?)", args: [Date.now(), Date.now()+60*24*60*60*1000] });
        if (operation === 'extend') {
          const hours = Number(body.hours);
          if (!Number.isSafeInteger(hours) || hours < 1 || hours > 2160) { await tx.rollback(); return fail('invalid_extension_hours'); }
          const updated = await tx.execute({sql:"UPDATE shorts_contest SET ends_at=MAX(ends_at,?)+?,status='active' WHERE id='main'",args:[Date.now(),hours*60*60*1000]});
          if (Number(updated.rowsAffected) !== 1) { await tx.rollback(); return fail('contest_not_found',404); }
        } else {
          const nextStatus = operation === 'pause' ? 'paused' : operation === 'cancel' ? 'cancelled' : 'active';
          const updated = await tx.execute({sql:"UPDATE shorts_contest SET status=? WHERE id='main'",args:[nextStatus]});
          if (Number(updated.rowsAffected) !== 1) { await tx.rollback(); return fail('contest_not_found',404); }
        }
      } else if (action === 'grant_coins' || action === 'grant_oil') {
        const column = action === 'grant_coins' ? 'coins_balance' : 'oil_balance';
        const exists = await tx.execute({ sql: 'SELECT telegram_id FROM players WHERE telegram_id=?', args: [target] });
        if (!exists.rows.length) { await tx.rollback(); return fail('player_not_found', 404); }
        await tx.execute({ sql: 'INSERT OR IGNORE INTO player_wallets(telegram_id) VALUES(?)', args: [target] });
        const beforeRow = await tx.execute({ sql: 'SELECT ' + column + ' AS balance FROM player_wallets WHERE telegram_id=?', args: [target] });
        const previousBalance = Number(beforeRow.rows[0]?.balance ?? 0);
        const balance = previousBalance + amount;
        const referenceId = randomUUID();

        // For coin grants, write the immutable admin ledger marker BEFORE the
        // wallet update. The database cap trigger recognizes this exact
        // (amount, balance_after) admin entry and bypasses only this admin grant.
        if (action === 'grant_coins') {
          await tx.execute({
            sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','admin_grant',?,?,'admin',?,?,?)",
            args: [randomUUID(), target, amount, balance, referenceId, `admin-grant:${referenceId}`, JSON.stringify({ reason, source: 'admin_panel', dailyLimitExempt: true })],
          });
        }
        const credited = await tx.execute({
          sql: 'UPDATE player_wallets SET ' + column + '= '+column+'+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
          args: [amount, target],
        });
        if (Number(credited.rowsAffected) !== 1) { await tx.rollback(); return fail('wallet_credit_failed', 503); }

        if (action === 'grant_coins') {
          await notify(tx, target, '🎁 مكافأة من إدارة اللعبة', `تمت إضافة ${amount.toLocaleString('en-US')} عملة إلى رصيدك. السبب: ${reason}`, 'reward', { amount, reason, balance, dailyLimitExempt: true });
        } else {
          await tx.execute({
            sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'oil','admin_grant',?,?,'admin',?,?,?)",
            args: [randomUUID(), target, amount, balance, referenceId, `admin-oil-grant:${referenceId}`, JSON.stringify({ reason })],
          });
          await tx.execute({
            sql: "INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,'admin_oil_grant',?,?,?)",
            args: [randomUUID(), target, amount, JSON.stringify({ reason }), `admin-oil:${referenceId}`],
          });
          await notify(tx, target, '🛢️ تمت إضافة نفط إلى حسابك', `أضافت الإدارة ${amount.toLocaleString('en-US')} وحدة نفط. السبب: ${reason}`, 'reward', { amount, reason, balance });
        }
        const snapshot = await tx.execute({ sql: 'SELECT state_json FROM player_game_snapshots WHERE telegram_id=?', args: [target] });
        if (snapshot.rows.length) {
          let state: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(String(snapshot.rows[0].state_json));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed as Record<string, unknown>;
          } catch { /* Snapshot will be healed by subsequent game sync. */ }
          state[action === 'grant_coins' ? 'coins' : 'oil'] = balance;
          await tx.execute({
            sql: 'UPDATE player_game_snapshots SET state_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
            args: [JSON.stringify(state), target],
          });
        }
      } else if (action === 'ban' || action === 'unban') {
        const status = action === 'ban' ? 'suspended' : 'active';
        const updated = await tx.execute({ sql: 'UPDATE players SET status=? WHERE telegram_id=?', args: [status, target] });
        if (Number(updated.rowsAffected) !== 1) { await tx.rollback(); return fail('player_not_found', 404); }
        await notify(tx, target, action === 'ban' ? '⛔ تم تعليق حسابك' : '✅ تمت إعادة تفعيل حسابك',
          action === 'ban' ? (reason || 'تم تعليق الحساب بواسطة الإدارة') : 'يمكنك الآن استخدام اللعبة مجددًا.', 'account');

      } else if (action === 'move_referral') {
        const refereeId = String(body.refereeTelegramId ?? '').trim().slice(0, 64);
        if (!target || !refereeId || target === refereeId) { await tx.rollback(); return fail('invalid_referral_move'); }
        const players = await tx.execute({
          sql: 'SELECT telegram_id FROM players WHERE telegram_id IN (?,?)',
          args: [target, refereeId],
        });
        if (players.rows.length !== 2) { await tx.rollback(); return fail('player_not_found', 404); }
        const cycle = await tx.execute({
          sql: `WITH RECURSIVE descendants(id) AS (SELECT referee_telegram_id FROM referrals WHERE referrer_telegram_id=? UNION SELECT r.referee_telegram_id FROM referrals r JOIN descendants d ON r.referrer_telegram_id=d.id) SELECT 1 AS cycle FROM descendants WHERE id=? LIMIT 1`,
          args: [refereeId, target],
        });
        if (cycle.rows.length) { await tx.rollback(); return fail('referral_cycle_not_allowed', 409); }
        await tx.execute({
          sql: `INSERT INTO referrals(id,referrer_telegram_id,referee_telegram_id,status) VALUES(?,?,?,'joined') ON CONFLICT(referee_telegram_id) DO UPDATE SET referrer_telegram_id=excluded.referrer_telegram_id`,
          args: [randomUUID(), target, refereeId],
        });
        await notify(tx, refereeId, '🔗 تم تحديث جهة الدعوة', 'تم تحديث الداعي المرتبط بحسابك بواسطة إدارة اللعبة.', 'referral', { newReferrerTelegramId: target });
      } else if (action === 'set_speed') {
        const speed = Number(body.speed);
        await tx.execute({ sql: 'INSERT OR IGNORE INTO player_game_state(telegram_id) VALUES(?)', args: [target] });
        await tx.execute({ sql: 'UPDATE player_game_state SET base_oil_per_tap=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?', args: [speed, target] });
        const snapshot = await tx.execute({ sql: 'SELECT state_json FROM player_game_snapshots WHERE telegram_id=?', args: [target] });
        if (snapshot.rows.length) {
          let state: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(String(snapshot.rows[0].state_json));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed as Record<string, unknown>;
          } catch { /* Settings remain authoritative in player_game_state. */ }
          state.baseOilPerTap = speed;
          await tx.execute({
            sql: 'UPDATE player_game_snapshots SET state_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
            args: [JSON.stringify(state), target],
          });
        }
        await notify(tx, target, '⚡ تم تحديث سرعة المضخة', `تم ضبط سرعة المضخة الأساسية إلى ${speed.toLocaleString('en-US')} وحدة لكل ضغطة.`, 'upgrade');
      } else if (action === 'withdrawal') {
        const id = String(body.id ?? '');
        const withdrawalStatus = String(body.status ?? '');
        const isUsdt = body.currency === 'usdt';
        const table = isUsdt ? 'usdt_withdrawal_requests' : 'withdrawal_requests';
        if (!id || !['paid', 'rejected'].includes(withdrawalStatus)) { await tx.rollback(); return fail('invalid_request'); }
        const rows = await tx.execute({
          sql: `SELECT * FROM ${table} WHERE id=? AND status='pending'`,
          args: [id],
        });
        if (!rows.rows.length) { await tx.rollback(); return fail('not_pending_or_missing', 409); }
        const row = rows.rows[0];
        const telegramId = String(row.telegram_id);
        const txHash = noteText(body.txHash);
        if (withdrawalStatus === 'paid' && !txHash) { await tx.rollback(); return fail('tx_hash_required'); }
        if (withdrawalStatus === 'rejected' && !reason) { await tx.rollback(); return fail('reason_required'); }

        if (isUsdt) {
          const micros = Number(row.usd_micros);
          const wallet = await tx.execute({ sql: 'SELECT usd_locked_micros FROM player_wallets WHERE telegram_id=?', args: [telegramId] });
          if (Number(wallet.rows[0]?.usd_locked_micros ?? 0) < micros) { await tx.rollback(); return fail('locked_balance_inconsistent', 409); }
          await tx.execute({
            sql: withdrawalStatus === 'rejected'
              ? 'UPDATE player_wallets SET usd_locked_micros=usd_locked_micros-?,usd_micros=usd_micros+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?'
              : 'UPDATE player_wallets SET usd_locked_micros=usd_locked_micros-?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
            args: withdrawalStatus === 'rejected' ? [micros, micros, telegramId] : [micros, telegramId],
          });
        } else {
          const coins = Number(row.coins);
          const wallet = await tx.execute({ sql: 'SELECT coins_locked FROM player_wallets WHERE telegram_id=?', args: [telegramId] });
          if (Number(wallet.rows[0]?.coins_locked ?? 0) < coins) { await tx.rollback(); return fail('locked_balance_inconsistent', 409); }
          await tx.execute({
            sql: withdrawalStatus === 'rejected'
              ? 'UPDATE player_wallets SET coins_locked=coins_locked-?,coins_balance=coins_balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?'
              : 'UPDATE player_wallets SET coins_locked=coins_locked-?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
            args: withdrawalStatus === 'rejected' ? [coins, coins, telegramId] : [coins, telegramId],
          });
          if (withdrawalStatus === 'rejected') {
            const walletAfter = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [telegramId] });
            await tx.execute({
              sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','withdrawal_refund',?,?,'withdrawal',?,?,?)",
              args: [randomUUID(), telegramId, coins, Number(walletAfter.rows[0]?.coins_balance ?? 0), id, `admin-withdrawal-refund:${id}`, JSON.stringify({ reason })],
            });
          }
        }
        await tx.execute({
          sql: `UPDATE ${table} SET status=?,tx_hash=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`,
          args: [withdrawalStatus, txHash, reason, id],
        });
        await notify(tx, telegramId,
          withdrawalStatus === 'rejected' ? '❌ تم رفض طلب السحب' : '✅ تمت الموافقة على طلب السحب',
          withdrawalStatus === 'rejected' ? `سبب الرفض: ${reason}` : 'تم اعتماد طلب السحب وتسجيله في سجلات الإدارة.',
          'withdrawal', { id, currency: isUsdt ? 'usdt' : 'ton', txHash });
      } else if (action === 'payment') {
        const id = String(body.id ?? '');
        const paymentStatus = String(body.status ?? '');
        const txHash = noteText(body.txHash);
        if (!id || !['confirmed', 'rejected'].includes(paymentStatus)) { await tx.rollback(); return fail('invalid_payment_action'); }
        if (paymentStatus === 'rejected' && !reason) { await tx.rollback(); return fail('reason_required'); }
        const rows = await tx.execute({ sql: "SELECT * FROM payment_transactions WHERE id=? AND status='pending'", args: [id] });
        if (!rows.rows.length) { await tx.rollback(); return fail('payment_not_pending', 409); }
        const payment = rows.rows[0];
        if (String(payment.provider) === 'tonconnect_auto') { await tx.rollback(); return fail('automatic_ton_payment_cannot_be_manually_approved', 409); }
        const telegramId = String(payment.telegram_id);
        const packageId = String(payment.package_id ?? '');

        if (paymentStatus === 'confirmed') {
          let payload: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(String(payment.provider_payload_json ?? '{}'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
          } catch { await tx.rollback(); return fail('invalid_payment_metadata', 409); }

          const rawPartId = String(payload.partId ?? payload.itemId ?? payload.productId ?? packageId).trim();
          const normalizedPartId = rawPartId.replace(/^(?:shop_part[:_]|part[:_])/, '');
          const legacyParts = ['oil_pump', 'fuel_station', 'oil_truck'];
          const specialParts = ['new_background', 'vip_badge', 'wheel_expansion', 'auto_sell'];
          const isShopPart = payload.kind === 'shop_part' || payload.type === 'shop_part' ||
            payload.category === 'shop_part' || legacyParts.includes(normalizedPartId) || specialParts.includes(normalizedPartId);
          if (isShopPart) {
            if (legacyParts.includes(normalizedPartId)) {
              await tx.execute({
                sql: 'INSERT INTO player_parts(telegram_id,part_id,quantity) VALUES(?,?,1) ON CONFLICT(telegram_id,part_id) DO UPDATE SET quantity=quantity+1,updated_at=CURRENT_TIMESTAMP',
                args: [telegramId, normalizedPartId],
              });
            } else if (specialParts.includes(normalizedPartId)) {
              await tx.execute(`CREATE TABLE IF NOT EXISTS player_special_parts (
                telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
                part_id TEXT NOT NULL CHECK(part_id IN ('new_background','vip_badge','wheel_expansion')),
                purchased_at INTEGER NOT NULL, expires_at INTEGER, payment_id TEXT NOT NULL UNIQUE,
                PRIMARY KEY(telegram_id,part_id,payment_id)
              )`);
              const now = Date.now();
              await tx.execute({
                sql: 'INSERT INTO player_special_parts(telegram_id,part_id,purchased_at,expires_at,payment_id) VALUES(?,?,?,?,?)',
                args: [telegramId, normalizedPartId, now, normalizedPartId === 'wheel_expansion' ? now + 72*60*60*1000 : normalizedPartId === 'auto_sell' ? now + 30*24*60*60*1000 : null, id],
              });
            } else { await tx.rollback(); return fail('invalid_part', 400); }
            const partNames: Record<string, string> = { oil_pump: 'مضخة النفط', fuel_station: 'محطة الوقود', oil_truck: 'شاحنة النفط', new_background: 'الخلفية الجديدة', vip_badge: 'شارة VIP', wheel_expansion: 'توسعة عجلة الحظ', auto_sell: 'البيع الآلي' };
            await notify(tx, telegramId, '🧰 تمت الموافقة على شراء القطعة', `تم تفعيل ${partNames[normalizedPartId]} في حسابك.`, 'part', { partId: normalizedPartId });
          } else {
            if (!PACKAGES.some((pkg) => pkg.id === packageId)) { await tx.rollback(); return fail('invalid_package'); }
            const now = Date.now();
            const expiresAt = new Date(now + UPGRADE_DURATION_MS).toISOString();
            await tx.execute({
              sql: "INSERT INTO player_upgrades(id,telegram_id,package_id,payment_id,purchased_at,expires_at,status) VALUES(?,?,?,?,?,?,'active')",
              args: [randomUUID(), telegramId, packageId, id, new Date(now).toISOString(), expiresAt],
            });
            await notify(tx, telegramId, '⚡ تمت الموافقة على الترقية', 'تم تفعيل باقة السرعة الجديدة في حسابك.', 'upgrade', { packageId });
          }
        }
        const updated = await tx.execute({
          sql: "UPDATE payment_transactions SET status=?,tx_hash=?,confirmed_at=CASE WHEN ?='confirmed' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=? AND status='pending'",
          args: [paymentStatus, txHash, paymentStatus, id],
        });
        if (Number(updated.rowsAffected) !== 1) { await tx.rollback(); return fail('payment_status_conflict', 409); }
        if (paymentStatus === 'rejected') {
          await notify(tx, telegramId, '❌ تم رفض طلب الشراء', `سبب الرفض: ${reason}`, 'payment', { id });
        }
      } else if (action === 'story_review') {
        const id = String(body.id ?? '').trim();
        const nextStatus = String(body.status ?? '');
        if (!id || !['approved','rejected'].includes(nextStatus)) { await tx.rollback(); return fail('invalid_story_review'); }
        const story = await tx.execute({
          sql: "SELECT telegram_id,story_url FROM telegram_story_submissions WHERE id=? AND status='pending'",
          args: [id],
        });
        if (!story.rows.length) { await tx.rollback(); return fail('story_not_pending', 409); }
        const telegramId = String(story.rows[0].telegram_id);
        const rejectionReason = 'تمت مراجعة حالتك ولم تنشر صورة اللعبة';
        const updated = await tx.execute({
          sql: "UPDATE telegram_story_submissions SET status=?,reviewed_at=CURRENT_TIMESTAMP,review_reason=? WHERE id=? AND status='pending'",
          args: [nextStatus, nextStatus === 'rejected' ? rejectionReason : null, id],
        });
        if (Number(updated.rowsAffected) !== 1) { await tx.rollback(); return fail('story_review_conflict', 409); }

        if (nextStatus === 'approved') {
          const reward = 500;
          await tx.execute({ sql: 'INSERT OR IGNORE INTO player_wallets(telegram_id) VALUES(?)', args: [telegramId] });
          await tx.execute({
            sql: 'UPDATE player_wallets SET coins_balance=coins_balance+?,lifetime_coins_earned=lifetime_coins_earned+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
            args: [reward, reward, telegramId],
          });
          const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [telegramId] });
          const balance = Number(wallet.rows[0]?.coins_balance ?? 0);
          await tx.execute({
            sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','task_reward',?,?,'telegram_story',?,?,?)",
            args: [randomUUID(), telegramId, reward, balance, id, `telegram-story:${id}`, JSON.stringify({ taskId: 'telegram_story_daily', storyUrl: String(story.rows[0].story_url) })],
          });
          const snapshot = await tx.execute({ sql: 'SELECT state_json FROM player_game_snapshots WHERE telegram_id=?', args: [telegramId] });
          if (snapshot.rows.length) {
            let state: Record<string, unknown> = {};
            try {
              const parsed = JSON.parse(String(snapshot.rows[0].state_json));
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed as Record<string, unknown>;
            } catch { /* Snapshot will be reconciled on next sync. */ }
            state.coins = balance;
            await tx.execute({
              sql: 'UPDATE player_game_snapshots SET state_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
              args: [JSON.stringify(state), telegramId],
            });
          }
          await notify(tx, telegramId, '🎉 تمت الموافقة على حالة تيليجرام', 'تم اعتماد نشر حالة ARMCO OIL وإضافة 500 عملة إلى رصيدك.', 'reward', { amount: reward, taskId: 'telegram_story_daily' });
        } else {
          await notify(tx, telegramId, 'تم رفض مهمة حالة تيليجرام', rejectionReason, 'announcement', { taskId: 'telegram_story_daily', rejectionReason });
        }
      } else if (action === 'shorts_review') {
        const id = String(body.id ?? '');
        const nextStatus = String(body.status ?? '');
        if (!id || !['approved','rejected'].includes(nextStatus)) { await tx.rollback(); return fail('invalid_shorts_review'); }
        const views = Number(body.views ?? 0);
        if (!id || !['approved','rejected'].includes(nextStatus) || !Number.isSafeInteger(views) || views < 0 || views > 2_000_000_000) { await tx.rollback(); return fail('invalid_shorts_review'); }
        const updated = await tx.execute({sql:'UPDATE shorts_entries SET status=?,declared_views=?,last_reported_at=? WHERE id=?',args:[nextStatus,views,Date.now(),id]});
        if (Number(updated.rowsAffected) !== 1) { await tx.rollback(); return fail('shorts_entry_not_found',404); }
        const entry = await tx.execute({sql:'SELECT telegram_id FROM shorts_entries WHERE id=?',args:[id]});
        if (entry.rows.length) await notify(tx,String(entry.rows[0].telegram_id),nextStatus==='approved'?'✅ تم اعتماد مشاركتك':'⚠️ تم استبعاد مشاركتك',nextStatus==='approved'?'تم اعتماد فيديو YouTube Shorts. ستُحدّث الإدارة عدد المشاهدات كل ساعة.':'تم استبعاد الفيديو من المسابقة بعد مراجعة الإدارة.','announcement',{entryId:id});
      } else if (action === 'broadcast_coins') {
        const quantity = Number(body.amount);
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000_000 || !reason) {
          await tx.rollback();
          return fail('invalid_broadcast_reward');
        }
        const users = await tx.execute("SELECT telegram_id FROM players WHERE status='active'");
        for (const row of users.rows) {
          const telegramId = String(row.telegram_id);
          await tx.execute({ sql: 'INSERT OR IGNORE INTO player_wallets(telegram_id) VALUES(?)', args: [telegramId] });
          await tx.execute({ sql: 'UPDATE player_wallets SET coins_balance=coins_balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?', args: [quantity, telegramId] });
          const wallet = await tx.execute({ sql: 'SELECT coins_balance FROM player_wallets WHERE telegram_id=?', args: [telegramId] });
          const balance = Number(wallet.rows[0]?.coins_balance ?? 0);
          const referenceId = randomUUID();
          await tx.execute({
            sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','admin_broadcast_grant',?,?,'admin_broadcast',?,?,?)",
            args: [randomUUID(), telegramId, quantity, balance, referenceId, `admin-broadcast:${referenceId}`, JSON.stringify({ reason })],
          });
          await notify(tx, telegramId, String(body.title || '🎁 مكافأة جماعية'), `تمت إضافة ${quantity.toLocaleString('en-US')} عملة إلى رصيدك. السبب: ${reason}`, 'reward', { amount: quantity, reason });
        }
      } else if (action === 'broadcast') {
        const title = String(body.title ?? '').trim().slice(0, 100);
        const message = String(body.message ?? '').trim().slice(0, 1000);
        if (!title || !message) { await tx.rollback(); return fail('message_required'); }
        const users = await tx.execute("SELECT telegram_id FROM players WHERE status='active'");
        for (const row of users.rows) await notify(tx, String(row.telegram_id), title, message, 'announcement');
        broadcastDelivered = users.rows.length;
      } else {
        await tx.rollback();
        return fail('unknown_action', 404);
      }

      await tx.execute({
        sql: 'INSERT INTO admin_audit_logs(id,admin_id,action,target_type,target_id,details_json) VALUES(?,?,?,?,?,?)',
        args: [randomUUID(), 'admin_session', action, action === 'withdrawal' ? 'withdrawal' : action === 'payment' ? 'payment' : action === 'broadcast' || action === 'broadcast_coins' ? 'broadcast' : action === 'shorts_contest' ? 'contest' : action === 'mining_fee_settings' ? 'settings' : 'player', target || String(body.id ?? body.operation ?? 'all'), JSON.stringify(body)],
      });
      await tx.commit();
      return NextResponse.json({ ok: true, ...(broadcastDelivered === null ? {} : { delivered: broadcastDelivered }) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('daily_coin_limit_reached')) return fail('daily_reward_limit_reached', 429);
    console.error('admin_action_failed', error);
    return fail('admin_action_failed', 503);
  }
}
