import { randomUUID, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { PACKAGES, UPGRADE_DURATION_MS } from '@/lib/wallets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN;
  const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!expected || expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
function fail(message: string, status = 400) { return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } }); }
function noteText(v: unknown, required = false) {
  const value = typeof v === 'string' ? v.trim().slice(0, 500) : '';
  return required && !value ? null : value;
}
async function notify(tx: Awaited<ReturnType<ReturnType<typeof getTurso>['transaction']>>, telegramId: string, title: string, message: string, kind: string, meta: unknown = {}) {
  await tx.execute({
    sql: 'INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,?,0,?,?)',
    args: [randomUUID(), telegramId, 'admin_notification', JSON.stringify({ title, message, kind, ...((meta && typeof meta === 'object') ? meta : {}) }), `admin-notice:${randomUUID()}`],
  });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return fail('unauthorized', 401);
  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const section = req.nextUrl.searchParams.get('section') ?? 'overview';
    const status = req.nextUrl.searchParams.get('status') ?? 'pending';
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80);
    if (section === 'overview') {
      const [players, active, wallet, withdrawals, usdt, payments, upgrades, ledger] = await Promise.all([
        db.execute('SELECT COUNT(*) total FROM players'),
        db.execute("SELECT COUNT(*) total FROM players WHERE status='active' AND last_seen_at>=datetime('now','-7 days')"),
        db.execute('SELECT COALESCE(SUM(coins_balance),0) coins,COALESCE(SUM(oil_balance),0) oil,COALESCE(SUM(coins_locked),0) locked FROM player_wallets'),
        db.execute("SELECT COUNT(*) total,SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending FROM withdrawal_requests"),
        db.execute("SELECT COUNT(*) total,SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending FROM usdt_withdrawal_requests"),
        db.execute("SELECT COUNT(*) total,SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending FROM payment_transactions"),
        db.execute("SELECT COUNT(*) total FROM player_upgrades WHERE status='active' AND expires_at>CURRENT_TIMESTAMP"),
        db.execute('SELECT COUNT(*) total FROM ledger_entries'),
      ]);
      const n = (rows: any[], key: string) => Number(rows[0]?.[key] ?? 0);
      return NextResponse.json({ overview: {
        players: n(players.rows,'total'), activePlayers: n(active.rows,'total'),
        coins: n(wallet.rows,'coins'), oil: n(wallet.rows,'oil'), lockedCoins: n(wallet.rows,'locked'),
        tonPending: n(withdrawals.rows,'pending'), usdtPending: n(usdt.rows,'pending'),
        paymentPending: n(payments.rows,'pending'), activeUpgrades: n(upgrades.rows,'total'),
        ledgerEntries: n(ledger.rows,'total')
      } }, { headers: {'Cache-Control':'no-store'} });
    }
    if (section === 'players') {
      const search = `%${q.replace(/[%_]/g,'')}%`;
      const rows = await db.execute({
        sql: `SELECT p.telegram_id,p.username,p.first_name,p.last_name,p.status,p.created_at,p.last_seen_at,
                     COALESCE(w.coins_balance,0) coins,COALESCE(w.oil_balance,0) oil,
                     COALESCE(w.usd_micros,0) usd_micros,COALESCE(g.base_oil_per_tap,2) base_oil_per_tap,
                     COALESCE(g.base_capacity,500) base_capacity
              FROM players p LEFT JOIN player_wallets w ON w.telegram_id=p.telegram_id
              LEFT JOIN player_game_state g ON g.telegram_id=p.telegram_id
              WHERE (?='' OR p.telegram_id LIKE ? OR COALESCE(p.username,'') LIKE ? OR COALESCE(p.first_name,'') LIKE ?)
              ORDER BY p.last_seen_at DESC LIMIT 250`,
        args: [q,search,search,search]
      });
      return NextResponse.json({ players: rows.rows }, { headers: {'Cache-Control':'no-store'} });
    }
    if (section === 'withdrawals') {
      const [ton, usdtRows] = await Promise.all([
        db.execute({sql:`SELECT w.*,p.username,p.first_name FROM withdrawal_requests w JOIN players p ON p.telegram_id=w.telegram_id WHERE (?='all' OR w.status=?) ORDER BY w.created_at DESC LIMIT 200`,args:[status,status]}),
        db.execute({sql:`SELECT w.*,p.username,p.first_name FROM usdt_withdrawal_requests w JOIN players p ON p.telegram_id=w.telegram_id WHERE (?='all' OR w.status=?) ORDER BY w.created_at DESC LIMIT 200`,args:[status,status]})
      ]);
      return NextResponse.json({ ton: ton.rows, usdt: usdtRows.rows }, {headers:{'Cache-Control':'no-store'}});
    }
    if (section === 'payments') {
      const rows = await db.execute({
        sql: `SELECT p.*,u.username,u.first_name FROM payment_transactions p JOIN players u ON u.telegram_id=p.telegram_id
              WHERE (?='all' OR p.status=?) ORDER BY p.created_at DESC LIMIT 200`,
        args:[status,status]
      });
      return NextResponse.json({ payments: rows.rows }, {headers:{'Cache-Control':'no-store'}});
    }
    if (section === 'audit') {
      const rows = await db.execute('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 150');
      return NextResponse.json({ logs: rows.rows }, {headers:{'Cache-Control':'no-store'}});
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
  if (['grant_coins','grant_oil','set_speed','ban','unban'].includes(action) && !target) return fail('player_required');
  if (['grant_coins','grant_oil'].includes(action) && (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000)) return fail('invalid_amount');
  if (action === 'grant_coins' && !reason) return fail('reason_required');
  if (action === 'set_speed' && (!Number.isSafeInteger(Number(body.speed)) || Number(body.speed) < 1 || Number(body.speed) > 1_000_000)) return fail('invalid_speed');

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const tx = await db.transaction('write');
    try {
      if (action === 'grant_coins' || action === 'grant_oil') {
        const asset = action === 'grant_coins' ? 'coins' : 'oil';
        const column = action === 'grant_coins' ? 'coins_balance' : 'oil_balance';
        const exists = await tx.execute({sql:'SELECT telegram_id FROM players WHERE telegram_id=?',args:[target]});
        if (!exists.rows.length) { await tx.rollback(); return fail('player_not_found',404); }
        await tx.execute({sql:`UPDATE player_wallets SET ${column}=${column}+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?`,args:[amount,target]});
        const current = await tx.execute({sql:`SELECT ${column} balance FROM player_wallets WHERE telegram_id=?`,args:[target]});
        const balance = Number(current.rows[0]?.balance ?? 0);
        if (asset === 'coins') {
          await tx.execute({sql:`INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?, 'coins','admin_grant',?,?,'admin',?,?,?)`,
            args:[randomUUID(),target,amount,balance,randomUUID(),`admin-grant:${randomUUID()}`,JSON.stringify({reason})]});
          const snap=await tx.execute({sql:'SELECT state_json FROM player_game_snapshots WHERE telegram_id=?',args:[target]});
          if(snap.rows.length){
            let st:Record<string,unknown>={};try{st=JSON.parse(String(snap.rows[0].state_json)) as Record<string,unknown>;}catch{}
            st.coins=balance;
            await tx.execute({sql:'UPDATE player_game_snapshots SET state_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',args:[JSON.stringify(st),target]});
          }
          await notify(tx,target,'🎁 مكافأة من إدارة اللعبة',`تمت إضافة ${amount.toLocaleString('en-US')} عملة إلى رصيدك. السبب: ${reason}`,'reward',{amount,reason});
        } else {
          await tx.execute({sql:`INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?, 'admin_oil_grant',?,?,?)`,
            args:[randomUUID(),target,amount,JSON.stringify({reason}),`admin-oil:${randomUUID()}`]});
          const snap=await tx.execute({sql:'SELECT state_json FROM player_game_snapshots WHERE telegram_id=?',args:[target]});
          if(snap.rows.length){
            let st:Record<string,unknown>={};try{st=JSON.parse(String(snap.rows[0].state_json)) as Record<string,unknown>;}catch{}
            st.oil=balance;
            await tx.execute({sql:'UPDATE player_game_snapshots SET state_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',args:[JSON.stringify(st),target]});
          }
          await notify(tx,target,'🛢️ تمت إضافة نفط إلى حسابك',`أضافت الإدارة ${amount} وحدة نفط. السبب: ${reason}`,'reward',{amount,reason});
        }
      } else if (action === 'ban' || action === 'unban') {
        const status = action === 'ban' ? 'suspended' : 'active';
        const updated = await tx.execute({sql:'UPDATE players SET status=? WHERE telegram_id=?',args:[status,target]});
        if (Number(updated.rowsAffected)!==1) { await tx.rollback(); return fail('player_not_found',404); }
        await notify(tx,target,action==='ban'?'⛔ تم تعليق حسابك':'✅ تمت إعادة تفعيل حسابك',
          action==='ban'?(reason ?? 'تم تعليق الحساب بواسطة الإدارة'):'يمكنك الآن استخدام اللعبة مجددًا.', 'account');
      } else if (action === 'set_speed') {
        const speed = Number(body.speed);
        await tx.execute({sql:'INSERT OR IGNORE INTO player_game_state(telegram_id) VALUES(?)',args:[target]});
        await tx.execute({sql:'UPDATE player_game_state SET base_oil_per_tap=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',args:[speed,target]});
        const gs=await tx.execute({sql:'SELECT state_json FROM player_game_snapshots WHERE telegram_id=?',args:[target]});
        if(gs.rows.length){
          let state:Record<string,unknown>={};try{state=JSON.parse(String(gs.rows[0].state_json)) as Record<string,unknown>;}catch{}
          state.baseOilPerTap=speed;
          await tx.execute({sql:'UPDATE player_game_snapshots SET state_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',args:[JSON.stringify(state),target]});
        }
        await notify(tx,target,'⚡ تم تحديث سرعة المضخة',`تم ضبط سرعة المضخة الأساسية إلى ${speed.toLocaleString('en-US')} وحدة لكل ضغطة.`,'upgrade');
      } else if (action === 'withdrawal') {
        const id=String(body.id??'');
        const status=String(body.status??'');
        const isUsdt=body.currency==='usdt';
        const table=isUsdt?'usdt_withdrawal_requests':'withdrawal_requests';
        if (!id || !['paid','rejected'].includes(status)) { await tx.rollback(); return fail('invalid_request'); }
        const row=await tx.execute({sql:`SELECT telegram_id,coins,usd_micros FROM ${table} WHERE id=? AND status='pending'`,args:[id]});
        if (!row.rows.length) { await tx.rollback(); return fail('not_pending_or_missing',409); }
        const telegramId=String(row.rows[0].telegram_id);
        if(isUsdt){
          const micros=Number(row.rows[0].usd_micros);
          const wallet=await tx.execute({sql:'SELECT usd_locked_micros FROM player_wallets WHERE telegram_id=?',args:[telegramId]});
          if(Number(wallet.rows[0]?.usd_locked_micros??0)<micros){await tx.rollback();return fail('locked_balance_inconsistent',409);}
          await tx.execute({sql:status==='rejected'
            ?'UPDATE player_wallets SET usd_locked_micros=usd_locked_micros-?,usd_micros=usd_micros+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?'
            :'UPDATE player_wallets SET usd_locked_micros=usd_locked_micros-?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
            args:status==='rejected'?[micros,micros,telegramId]:[micros,telegramId]});
        } else {
          const coins=Number(row.rows[0].coins);
          const wallet=await tx.execute({sql:'SELECT coins_locked FROM player_wallets WHERE telegram_id=?',args:[telegramId]});
          if(Number(wallet.rows[0]?.coins_locked??0)<coins){await tx.rollback();return fail('locked_balance_inconsistent',409);}
          await tx.execute({sql:status==='rejected'
            ?'UPDATE player_wallets SET coins_locked=coins_locked-?,coins_balance=coins_balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?'
            :'UPDATE player_wallets SET coins_locked=coins_locked-?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
            args:status==='rejected'?[coins,coins,telegramId]:[coins,telegramId]});
          if(status==='rejected'){
            const after=await tx.execute({sql:'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',args:[telegramId]});
            await tx.execute({sql:`INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?, 'coins','withdrawal_refund',?,?,'withdrawal',?,?,?)`,
              args:[randomUUID(),telegramId,coins,Number(after.rows[0]?.coins_balance??0),id,`admin-withdrawal-refund:${id}`,JSON.stringify({reason})]});
          }
        }
        const hash=noteText(body.txHash);
        if(status==='paid'&&!hash){await tx.rollback();return fail('tx_hash_required');}
        const updated=await tx.execute({sql:`UPDATE ${table} SET status=?,tx_hash=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`,
          args:[status,hash,reason,id]});
        if(Number(updated.rowsAffected)!==1){await tx.rollback();return fail('status_conflict',409);}
        await notify(tx,telegramId,status==='rejected'?'❌ تم رفض طلب السحب':'✅ تمت الموافقة على طلب السحب',
          status==='rejected'?`سبب الرفض: ${reason||'لم يتم توضيح السبب'}`:'تم اعتماد طلب السحب وتسجيله في سجلات الإدارة.',
          'withdrawal',{id,currency:body.currency??'ton',txHash:hash});
      } else if (action === 'payment') {
        const id=String(body.id??'');
        const status=String(body.status??'');
        const txHash=noteText(body.txHash);
        const row=await tx.execute({sql:`SELECT * FROM payment_transactions WHERE id=? AND status='pending'`,args:[id]});
        if(!row.rows.length){await tx.rollback();return fail('payment_not_pending',409);}
        const p=row.rows[0], telegramId=String(p.telegram_id), pkg=String(p.package_id??'');
        if(!['confirmed','rejected'].includes(status)){await tx.rollback();return fail('invalid_status');}
        if(status==='rejected'&&!noteText(body.reason,true)){await tx.rollback();return fail('reason_required');}
        if(status==='confirmed'){
          const payload=JSON.parse(String(p.provider_payload_json??'{}'));
          if(payload.kind==='shop_part'){
            const part=pkg;
            const valid=['oil_pump','fuel_station','oil_truck'].includes(part);
            if(!valid){await tx.rollback();return fail('invalid_part',400);}
            await tx.execute({sql:'INSERT INTO player_parts(telegram_id,part_id,quantity) VALUES(?,?,1) ON CONFLICT(telegram_id,part_id) DO UPDATE SET quantity=quantity+1',args:[telegramId,part]});
            await notify(tx,telegramId,'🧰 تمت الموافقة على شراء القطعة','تم تفعيل القطعة في حسابك وأصبحت متاحة في اللعبة.','part',{partId:part});
          }else{
            const pkgDef=PACKAGES.find(x=>x.id===pkg);
            if(!pkgDef){await tx.rollback();return fail('invalid_package');}
            const expiry=new Date(Date.now()+UPGRADE_DURATION_MS).toISOString();
            await tx.execute({sql:'INSERT INTO player_upgrades(id,telegram_id,package_id,payment_id,expires_at,status) VALUES(?,?,?,?,?,'active')',args:[randomUUID(),telegramId,pkg,id,expiry]});
            const snapshot=await tx.execute({sql:'SELECT state_json FROM player_game_snapshots WHERE telegram_id=?',args:[telegramId]});
            if(snapshot.rows.length){
              let state:any={};try{state=JSON.parse(String(snapshot.rows[0].state_json));}catch{}
              state.upgrades=Array.isArray(state.upgrades)?state.upgrades:[];
              state.upgrades.push({packageId:pkg,purchasedAt:Date.now(),expiresAt:Date.now()+UPGRADE_DURATION_MS,paidWith:'gram',txHash:txHash??id});
              await tx.execute({sql:'UPDATE player_game_snapshots SET state_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',args:[JSON.stringify(state),telegramId]});
            }
            await notify(tx,telegramId,'⚡ تمت الموافقة على الترقية','تم تفعيل باقة السرعة الجديدة في حسابك.','upgrade',{packageId:pkg});
          }
        }
        const updated=await tx.execute({sql:'UPDATE payment_transactions SET status=?,tx_hash=?,confirmed_at=CASE WHEN ?=\'confirmed\' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=? AND status=\'pending\'',args:[status,txHash,status,id]});
        if(Number(updated.rowsAffected)!==1){await tx.rollback();return fail('payment_status_conflict',409);}
        if(status==='rejected') await notify(tx,telegramId,'❌ تم رفض طلب الشراء',`سبب الرفض: ${reason??'تعذر التحقق من الدفعة'}`,'payment',{id});
      if (action === 'broadcast_coins') {
        const qty=Number(body.amount), why=noteText(body.reason,true);
        if(!Number.isSafeInteger(qty)||qty<=0||qty>1_000_000_000||!why){await tx.rollback();return fail('invalid_broadcast_reward');}
        const users=await tx.execute("SELECT telegram_id FROM players WHERE status='active'");
        for(const row of users.rows){
          const uid=String(row.telegram_id);
          await tx.execute({sql:'UPDATE player_wallets SET coins_balance=coins_balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',args:[qty,uid]});
          const after=await tx.execute({sql:'SELECT coins_balance FROM player_wallets WHERE telegram_id=?',args:[uid]});
          await tx.execute({sql:"INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','admin_broadcast_grant',?,?,'admin_broadcast',?,?,?)",
            args:[randomUUID(),uid,qty,Number(after.rows[0]?.coins_balance??0),randomUUID(),`admin-broadcast:${uid}:${randomUUID()}`,JSON.stringify({reason:why})]});
          await notify(tx,uid,String(body.title||'🎁 مكافأة جماعية'),`تمت إضافة ${qty.toLocaleString('en-US')} عملة إلى رصيدك. السبب: ${why}`,'reward',{amount:qty,reason:why});
        }
      } else if (action === 'broadcast') {
        const title=String(body.title??'').trim().slice(0,100);
        const message=String(body.message??'').trim().slice(0,1000);
        if(!title||!message){await tx.rollback();return fail('message_required');}
        const users=await tx.execute("SELECT telegram_id FROM players WHERE status='active'");
        for(const row of users.rows) await notify(tx,String(row.telegram_id),title,message,'announcement');
      } else {
        await tx.rollback();
        return fail('unknown_action',404);
      }
      await audit(tx,action, action==='withdrawal'?'withdrawal':action==='payment'?'payment':'player', target||String(body.id??'all'), body);
      await tx.execute({
        sql: 'INSERT INTO admin_audit_logs(id,admin_id,action,target_type,target_id,details_json) VALUES(?,?,?,?,?,?)',
        args: [randomUUID(), 'admin_session', action, action==='withdrawal'?'withdrawal':action==='payment'?'payment':'player', target||String(body.id??'all'), JSON.stringify(body)],
      });
      await tx.commit();
      return NextResponse.json({ok:true});
    }catch(error){await tx.rollback();throw error;}
  }catch(error){console.error('admin_action_failed',error);return fail('admin_action_failed',503);}
}
