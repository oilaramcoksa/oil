import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Address, toNano } from '@ton/core';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { getVerifiedTelegramUser } from '@/lib/telegram-auth';
import { PACKAGES, WALLETS, UPGRADE_DURATION_MS } from '@/lib/wallets';
import { publishPaymentNotice } from '@/lib/telegram-payment-notice';

const SHOP_PARTS = [
  { id: 'oil_pump', priceTon: 2 }, { id: 'fuel_station', priceTon: 1.5 },
  { id: 'oil_truck', priceTon: 1 }, { id: 'new_background', priceTon: 1 },
  { id: 'vip_badge', priceTon: 5 }, { id: 'wheel_expansion', priceTon: 1 },\n  { id: 'arena_tokens_10000', priceTon: 1 },
] as const;
const RECEIVER = process.env.TON_MINING_FEE_WALLET || WALLETS.find(w => w.code === 'gram')?.address || '';
const TONCENTER = (process.env.TONCENTER_API_URL || 'https://toncenter.com/api/v2').replace(/\/$/, '');
const WINDOW_MS = 30 * 60 * 1000;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}
function canonical(value: string) {
  try { return Address.parse(value).toRawString().toLowerCase(); } catch { return ''; }
}
async function ensurePurchaseSchema() {
  const db = getTurso();
  await db.execute(`CREATE TABLE IF NOT EXISTS player_product_controls (
    id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
    product_id TEXT NOT NULL, product_type TEXT NOT NULL CHECK(product_type IN ('part','package')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','revoked')),
    speed_multiplier REAL NOT NULL DEFAULT 1 CHECK(speed_multiplier >= 0 AND speed_multiplier <= 100),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(telegram_id,product_id,product_type)
  )`);
}
async function incomingTransactions() {
  const headers: Record<string,string> = { 'Content-Type':'application/json' };
  if (process.env.TONCENTER_API_KEY) headers['X-API-Key'] = process.env.TONCENTER_API_KEY;
  const res = await fetch(TONCENTER + '/getTransactions', {
    method:'POST', headers, body:JSON.stringify({address:RECEIVER,limit:100}),
    cache:'no-store', signal:AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error('toncenter_unavailable');
  const data = await res.json() as {ok?:boolean;result?:Array<any>};
  if (data.ok !== true || !Array.isArray(data.result)) throw new Error('toncenter_invalid_response');
  return data.result;
}
async function activatePurchase(id: string, telegramId: string, txHash: string) {
  const db = getTurso();
  const tx = await db.transaction('write');
  try {
    const rows = await tx.execute({sql:"SELECT * FROM payment_transactions WHERE id=? AND telegram_id=? AND status='pending'",args:[id,telegramId]});
    if (!rows.rows.length) { await tx.rollback(); return false; }
    const payment = rows.rows[0];
    const payload = JSON.parse(String(payment.provider_payload_json || '{}')) as Record<string,unknown>;
    const productId = String(payment.package_id);
    const kind = String(payload.kind);
    const duplicate = await tx.execute({sql:"SELECT id FROM payment_transactions WHERE tx_hash=? AND status='confirmed'",args:[txHash]});
    if (duplicate.rows.length) { await tx.rollback(); return false; }
    if (kind === 'shop_part') {
      if (['oil_pump','fuel_station','oil_truck'].includes(productId)) {
        await tx.execute({sql:'INSERT INTO player_parts(telegram_id,part_id,quantity) VALUES(?,?,1) ON CONFLICT(telegram_id,part_id) DO UPDATE SET quantity=quantity+1,updated_at=CURRENT_TIMESTAMP',args:[telegramId,productId]});
      } else {
        await tx.execute(`CREATE TABLE IF NOT EXISTS player_special_parts (
          telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
          part_id TEXT NOT NULL, purchased_at INTEGER NOT NULL, expires_at INTEGER,
          payment_id TEXT NOT NULL UNIQUE, usage_count INTEGER NOT NULL DEFAULT 0 CHECK(usage_count >= 0), PRIMARY KEY(telegram_id,part_id,payment_id)
        )`);
        const now=Date.now();
        await tx.execute({sql:'INSERT INTO player_special_parts(telegram_id,part_id,purchased_at,expires_at,payment_id,usage_count) VALUES(?,?,?,?,?,0)',args:[telegramId,productId,now,productId==='wheel_expansion'?now+72*60*60*1000:null,id]});
      }
    } else {
      if (!PACKAGES.some(p=>p.id===productId)) { await tx.rollback(); return false; }
      const now=Date.now();
      await tx.execute({sql:"INSERT INTO player_upgrades(id,telegram_id,package_id,payment_id,purchased_at,expires_at,status) VALUES(?,?,?,?,?,?,'active')",args:[randomUUID(),telegramId,productId,id,new Date(now).toISOString(),new Date(now+UPGRADE_DURATION_MS).toISOString()]});
    }
    await tx.execute({sql:"INSERT INTO player_product_controls(id,telegram_id,product_id,product_type,status,speed_multiplier) VALUES(?,?,?,?,'active',1) ON CONFLICT(telegram_id,product_id,product_type) DO UPDATE SET status='active',speed_multiplier=1,updated_at=CURRENT_TIMESTAMP",args:[randomUUID(),telegramId,productId,kind==='shop_part'?'part':'package']});
    const changed=await tx.execute({sql:"UPDATE payment_transactions SET status='confirmed',tx_hash=?,confirmed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",args:[txHash,id]});
    if(Number(changed.rowsAffected)!==1){await tx.rollback();return false;}
    await tx.execute({sql:'INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,?,?,?,?)',args:[randomUUID(),telegramId,'purchase_activated',0,JSON.stringify({productId,kind,txHash}), 'purchase:'+id]});
    await tx.commit(); return true;
  } catch(e) { await tx.rollback(); throw e; }
}
export async function POST(req: NextRequest) {
  const user=getVerifiedTelegramUser(req);
  if(!user)return error('telegram_auth_required',401);
  let body:{packageId?:unknown;itemId?:unknown};
  try{body=await req.json();}catch{return error('invalid_body');}
  const pkg=PACKAGES.find(p=>p.id===body.packageId);
  const part=SHOP_PARTS.find(p=>p.id===body.itemId);
  if((!pkg&&!part)||!RECEIVER)return error('invalid_product_or_wallet',400);
  try{
    await ensureDatabaseSchema(); await ensurePurchaseSchema();
    const id=randomUUID();
    const amount=part?part.priceTon:pkg!.priceTon;
    const kind=part?'shop_part':'upgrade_package';
    const comment='ARMCO STORE '+id;
    const db=getTurso();
    await db.execute({sql:`INSERT INTO payment_transactions
      (id,telegram_id,provider,asset,network,amount,package_id,status,provider_payload_json)
      VALUES(?,?,'tonconnect_auto','TON','TON Mainnet',?,?,'pending',?)`,
      args:[id,String(user.id),String(amount),part?.id??pkg!.id,JSON.stringify({kind,destination:RECEIVER,amountNanoton:toNano(String(amount)).toString(),comment,expiresAt:Date.now()+WINDOW_MS})]});
    return NextResponse.json({payment:{id,status:'pending',itemId:part?.id??null,packageId:pkg?.id??null,amount,currency:'TON',destination:RECEIVER,comment,amountNanoton:toNano(String(amount)).toString(),expiresAt:Date.now()+WINDOW_MS}},{status:201,headers:{'Cache-Control':'no-store'}});
  }catch(e){console.error('payment_request_failed',e);return error('payment_request_failed',503);}
}
export async function GET(req: NextRequest) {
  const user=getVerifiedTelegramUser(req);
  if(!user)return error('telegram_auth_required',401);
  const id=req.nextUrl.searchParams.get('id')??'';
  if(!id||id.length>64)return error('invalid_payment_id');
  try{
    await ensureDatabaseSchema(); await ensurePurchaseSchema();
    const db=getTurso();
    const found=await db.execute({sql:'SELECT * FROM payment_transactions WHERE id=? AND telegram_id=?',args:[id,String(user.id)]});
    if(!found.rows.length)return error('payment_not_found',404);
    const row=found.rows[0];
    if(String(row.status)==='pending' && String(row.provider)==='tonconnect_auto'){
      const payload=JSON.parse(String(row.provider_payload_json||'{}')) as Record<string,unknown>;
      if(Date.now()>Number(payload.expiresAt??0)){
        await db.execute({sql:"UPDATE payment_transactions SET status='expired' WHERE id=? AND status='pending'",args:[id]});
      }else{
        const txs=await incomingTransactions();
        const created=Date.parse(String(row.created_at).replace(' ','T')+'Z')/1000;
        const foundTx=txs.find(item=>{
          const msg=item.in_msg;
          return msg && canonical(String(msg.destination??''))===canonical(RECEIVER) &&
            String(msg.value??'0')===String(payload.amountNanoton) &&
            String(msg.message??'').trim()===String(payload.comment) &&
            Number(item.utime??0)>=created-30 && !!item.transaction_id?.hash &&
            item.description?.aborted!==true && item.description?.compute_ph?.success!==false && item.description?.action?.success!==false;
        });
        if (foundTx?.transaction_id?.hash) {
          const activated = await activatePurchase(id, String(user.id), String(foundTx.transaction_id.hash));
          if (activated) {
            const productId = String(row.package_id);
            const productNames: Record<string, string> = {
              fast_oil: 'باقة تسريع Fast Oil',
              king_oil: 'باقة تسريع King Oil',
              super_oil: 'باقة تسريع Super Oil',
              oil_pump: 'قطعة مضخة النفط',
              fuel_station: 'قطعة محطة الوقود',
              oil_truck: 'قطعة شاحنة النفط',
              new_background: 'قطعة خلفية جديدة',
              vip_badge: 'شارة VIP',
              wheel_expansion: 'توسعة العجلة',
            };
            await publishPaymentNotice({
              username: user.username,
              firstName: user.first_name,
              telegramId: String(user.id),
              title: 'تم شراء ' + (productNames[productId] ?? productId),
              amount: String(row.amount) + ' TON',
              txHash: String(foundTx.transaction_id.hash),
            });
          }
        }
      }
    }
    const current=await db.execute({sql:'SELECT id,status,package_id,tx_hash,confirmed_at FROM payment_transactions WHERE id=? AND telegram_id=?',args:[id,String(user.id)]});
    const p=current.rows[0];
    return NextResponse.json({payment:{id:String(p.id),status:String(p.status),packageId:String(p.package_id),txHash:p.tx_hash?String(p.tx_hash):null,confirmedAt:p.confirmed_at?String(p.confirmed_at):null}},{headers:{'Cache-Control':'no-store'}});
  }catch(e){console.error('payment_status_failed',e);return error('payment_status_unavailable',503);}
}
