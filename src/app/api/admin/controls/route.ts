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

    if (section === 'overview') {
      const [players, active, wallet, ton, usdt, payments, upgrades, ledger] = await Promise.all([
        db.execute('SELECT COUNT(*) AS total FROM players'),
        db.execute("SELECT COUNT(*) AS total FROM players WHERE status='active' AND last_seen_at >= datetime('now','-7 days')"),
        db.execute('SELECT COALESCE(SUM(coins_balance),0) AS coins, COALESCE(SUM(oil_balance),0) AS oil, COALESCE(SUM(coins_locked),0) AS locked FROM player_wallets'),
        db.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending FROM withdrawal_requests"),
        db.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending FROM usdt_withdrawal_requests"),
        db.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending FROM payment_transactions"),
        db.execute("SELECT COUNT(*) AS total FROM player_upgrades WHERE status='active' AND expires_at > CURRENT_TIMESTAMP"),
        db.execute('SELECT COUNT(*) AS total FROM ledger_entries'),
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
      } }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (section === 'players') {
      const like = `%${query.replace(/[%_]/g, '')}%`;
      const rows = await db.execute({
        sql: `SELECT p.telegram_id,p.username,p.first_name,p.last_name,p.status,p.created_at,p.last_seen_at,
                     COALESCE(w.coins_balance,0) AS coins,COALESCE(w.oil_balance,0) AS oil,
                     COALESCE(w.usd_micros,0) AS usd_micros,
                     COALESCE(g.base_oil_per_tap,2) AS base_oil_per_tap,
                     COALESCE(g.base_capacity,500) AS base_capacity
              FROM players p
              LEFT JOIN player_wallets w ON w.telegram_id=p.telegram_id
              LEFT JOIN player_game_state g ON g.telegram_id=p.telegram_id
              WHERE (?='' OR p.telegram_id LIKE ? OR COALESCE(p.username,'') LIKE ? OR COALESCE(p.first_name,'') LIKE ?)
              ORDER BY p.last_seen_at DESC LIMIT 250`,
        args: [query, like, like, like],
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

  if (['grant_coins', 'grant_oil', 'set_speed', 'ban', 'unban'].includes(action) && !target) return fail('player_required');
  if (['grant_coins', 'grant_oil'].includes(action) &&
      (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000)) return fail('invalid_amount');
  if (action === 'grant_coins' && !reason) return fail('reason_required');
  if (action === 'set_speed' &&
      (!Number.isSafeInteger(Number(body.speed)) || Number(body.speed) < 1 || Number(body.speed) > 1_000_000)) return fail('invalid_speed');

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const tx = await db.transaction('write');
    try {
      if (action === 'shorts_contest') {
        const operation = String(body.operation ?? '');
        if (!['pause','cancel','activate','extend'].includes(operation)) { await tx.rollback(); return fail('invalid_contest_operation'); }
        await tx.execute(`CREATE TABLE IF NOT EXISTS shorts_contest (
          id TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','cancelled')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);
        try { await tx.execute("ALTER TABLE shorts_contest ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','cancelled'))"); } catch { /* Column already exists. */ }
        await tx.execute("INSERT OR IGNORE INTO shorts_contest(id,starts_at,ends_at) VALUES('main',?,?)", [Date.now(), Date.now()+60*24*60*60*1000]);
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
        await tx.execute({ sql: 'UPDATE player_wallets SET ' + column + '=' + column + '+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?', args: [amount, target] });
        const wallet = await tx.execute({ sql: 'SELECT ' + column + ' AS balance FROM player_wallets WHERE telegram_id=?', args: [target] });
        const balance = Number(wallet.rows[0]?.balance ?? 0);

        if (action === 'grant_coins') {
          const referenceId = randomUUID();
          await tx.execute({
            sql: "INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','admin_grant',?,?,'admin',?,?,?)",
            args: [randomUUID(), target, amount, balance, referenceId, `admin-grant:${referenceId}`, JSON.stringify({ reason })],
          });
          await notify(tx, target, '🎁 مكافأة من إدارة اللعبة', `تمت إضافة ${amount.toLocaleString('en-US')} عملة إلى رصيدك. السبب: ${reason}`, 'reward', { amount, reason });
        } else {
          await tx.execute({
            sql: "INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,'admin_oil_grant',?,?,?)",
            args: [randomUUID(), target, amount, JSON.stringify({ reason }), `admin-oil:${randomUUID()}`],
          });
          await notify(tx, target, '🛢️ تمت إضافة نفط إلى حسابك', `أضافت الإدارة ${amount.toLocaleString('en-US')} وحدة نفط. السبب: ${reason}`, 'reward', { amount, reason });
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
        await tx.execute({
          sql: `INSERT INTO referrals(id,referrer_telegram_id,referee_telegram_id,status)
                VALUES(?,?,?,'joined')
                ON CONFLICT(referee_telegram_id) DO UPDATE SET
                referrer_telegram_id=excluded.referrer_telegram_id`,
          args: [randomUUID(), target, refereeId],
        });
        await notify(tx, refereeId, '🔗 تم تحديث جهة الدعوة', 'تم تحديث بيانات الإحالة المرتبطة بحسابك بواسطة إدارة اللعبة.', 'referral');
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
        args: [randomUUID(), 'admin_session', action, action === 'withdrawal' ? 'withdrawal' : action === 'payment' ? 'payment' : action === 'broadcast' || action === 'broadcast_coins' ? 'broadcast' : action === 'shorts_contest' ? 'contest' : 'player', target || String(body.id ?? body.operation ?? 'all'), JSON.stringify(body)],
      });
      await tx.commit();
      return NextResponse.json({ ok: true, ...(broadcastDelivered === null ? {} : { delivered: broadcastDelivered }) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    console.error('admin_action_failed', error);
    return fail('admin_action_failed', 503);
  }
}
