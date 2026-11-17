import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { PACKAGES, UPGRADE_DURATION_MS } from '@/lib/wallets';

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

  if (['grant_coins', 'grant_oil', 'set_speed', 'ban', 'unban', 'product_control'].includes(action) && !target) return fail('player_required');
  if (['grant_coins', 'grant_oil'].includes(action) &&
      (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000)) return fail('invalid_amount');
  if (action === 'grant_coins' && !reason) return fail('reason_required');
  if (action === 'set_speed' &&
      (!Number.isSafeInteger(Number(body.speed)) || Number(body.speed) < 1 || Number(body.speed) > 1_000_000)) return fail('invalid_speed');
  if (action === 'set_mining_fee_exemption' && !['0','1'].includes(String(body.exempt))) return fail('invalid_exemption_value');

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const tx = await db.transaction('write');
    try {
      if (action === 'mark_notifications_read') {
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
      if (action === 'product_control') {
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
          const specialParts = ['new_background', 'vip_badge', 'wheel_expansion'];
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
                args: [telegramId, normalizedPartId, now, normalizedPartId === 'wheel_expansion' ? now + 72*60*60*1000 : null, id],
              });
            } else { await tx.rollback(); return fail('invalid_part', 400); }
            const partNames: Record<string, string> = { oil_pump: 'مضخة النفط', fuel_station: 'محطة الوقود', oil_truck: 'شاحنة النفط', new_background: 'الخلفية الجديدة', vip_badge: 'شارة VIP', wheel_expansion: 'توسعة عجلة الحظ' };
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
