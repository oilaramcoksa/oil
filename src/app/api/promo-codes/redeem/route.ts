import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { ensurePromoSchema } from '@/lib/promo-codes';
import { getVerifiedTelegramUser } from '@/lib/telegram-auth';
import { PACKAGES, UPGRADE_DURATION_MS } from '@/lib/wallets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PARTS = ['plane_tips','auto_sell','oil_pump','fuel_station','oil_truck','new_background','vip_badge','wheel_expansion','arena_tokens_10000'];
function fail(error:string,status=400){return NextResponse.json({error},{status,headers:{'Cache-Control':'no-store'}});}

export async function POST(req:NextRequest){
  const user=getVerifiedTelegramUser(req);
  if(!user)return fail('telegram_auth_required',401);
  let body:{code?:unknown;productId?:unknown};
  try{body=await req.json();}catch{return fail('invalid_body');}
  const code=String(body.code??'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,40);
  const productId=String(body.productId??'');
  if(!code)return fail('promo_code_required');
  try{
    await ensureDatabaseSchema(); await ensurePromoSchema();
    const db=getTurso(); const tx=await db.transaction('write');
    try{
      const found=await tx.execute({sql:'SELECT * FROM promo_codes WHERE code=? COLLATE NOCASE AND active=1',args:[code]});
      if(!found.rows.length){await tx.rollback();return fail('promo_invalid_or_inactive',404);}
      const promo=found.rows[0]; const now=new Date();
      if(promo.starts_at && now<new Date(String(promo.starts_at))){await tx.rollback();return fail('promo_not_started');}
      if(promo.expires_at && now>new Date(String(promo.expires_at))){await tx.rollback();return fail('promo_expired');}
      const limit=Number(promo.per_user_limit??1);
      const used=await tx.execute({sql:'SELECT COUNT(*) AS n FROM promo_redemptions WHERE promo_id=? AND telegram_id=?',args:[String(promo.id),String(user.id)]});
      if(Number(used.rows[0]?.n??0)>=limit){await tx.rollback();return fail('promo_user_limit_reached',409);}
      if(promo.total_limit!=null && Number(promo.total_uses)>=Number(promo.total_limit)){await tx.rollback();return fail('promo_total_limit_reached',409);}
      const type=String(promo.promo_type); const configured=String(promo.product_id??'');
      if(type==='free_part' && (!PARTS.includes(productId) || (configured && configured!=='any' && configured!==productId))){await tx.rollback();return fail('promo_product_mismatch');}
      if(type==='free_package' && (!PACKAGES.some(p=>p.id===productId) || (configured && configured!=='any' && configured!==productId))){await tx.rollback();return fail('promo_product_mismatch');}
      if(type==='mining_fee'){
        const player=await tx.execute({sql:'SELECT fee_exempt,mining_fee_paid_at FROM players WHERE telegram_id=?',args:[String(user.id)]});
        if(!player.rows.length){await tx.rollback();return fail('player_not_found',404);}
        if(Number(player.rows[0].fee_exempt??0)===1 || player.rows[0].mining_fee_paid_at){await tx.rollback();return fail('mining_fee_already_paid',409);}
        await tx.execute({sql:'UPDATE players SET mining_fee_paid_at=CURRENT_TIMESTAMP WHERE telegram_id=?',args:[String(user.id)]});
      }else if(type==='free_part'){
        if(productId==='oil_pump'||productId==='fuel_station'||productId==='oil_truck'){
          await tx.execute({sql:'INSERT INTO player_parts(telegram_id,part_id,quantity) VALUES(?,?,1) ON CONFLICT(telegram_id,part_id) DO UPDATE SET quantity=quantity+1,updated_at=CURRENT_TIMESTAMP',args:[String(user.id),productId]});
        }else if(productId==='arena_tokens_10000'){
          const balance=await tx.execute({sql:'INSERT INTO bet_token_balances(telegram_id,balance) VALUES(?,10000) ON CONFLICT(telegram_id) DO UPDATE SET balance=balance+10000,updated_at=CURRENT_TIMESTAMP RETURNING balance',args:[String(user.id)]});
          await tx.execute({sql:"INSERT INTO bet_token_transactions(id,telegram_id,transaction_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'purchase',?,?, 'promo',?,?,?)",args:[randomUUID(),String(user.id),10000,Number(balance.rows[0]?.balance??0),String(promo.id),randomUUID(),JSON.stringify({promoCode:code,productId})]});
        }else{
          await tx.execute(`CREATE TABLE IF NOT EXISTS player_special_parts(telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,part_id TEXT NOT NULL,purchased_at INTEGER NOT NULL,expires_at INTEGER,payment_id TEXT NOT NULL UNIQUE,usage_count INTEGER NOT NULL DEFAULT 0 CHECK(usage_count>=0),PRIMARY KEY(telegram_id,part_id,payment_id))`);
          const nowMs=Date.now();
          await tx.execute({sql:'INSERT INTO player_special_parts(telegram_id,part_id,purchased_at,expires_at,payment_id,usage_count) VALUES(?,?,?,?,?,0)',args:[String(user.id),productId,nowMs,productId==='wheel_expansion'?nowMs+72*60*60*1000:productId==='auto_sell'?nowMs+30*24*60*60*1000:null,'promo:'+randomUUID()]});
        }
      }else if(type==='free_package'){
        const nowMs=Date.now();
        await tx.execute({sql:"INSERT INTO player_upgrades(id,telegram_id,package_id,payment_id,purchased_at,expires_at,status) VALUES(?,?,?,NULL,?,?,'active')",args:[randomUUID(),String(user.id),productId,new Date(nowMs).toISOString(),new Date(nowMs+UPGRADE_DURATION_MS).toISOString()]});
      }else if(type==='coins'){
        const reward=Math.floor(Number(promo.reward_coins));
        if(!Number.isSafeInteger(reward)||reward<=0||reward>1000000000){await tx.rollback();return fail('promo_reward_invalid',409);}
        const credit=await tx.execute({sql:'UPDATE player_wallets SET coins_balance=coins_balance+?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=? RETURNING coins_balance',args:[reward,String(user.id)]});
        if(!credit.rows.length){await tx.rollback();return fail('wallet_not_found',409);}
        await tx.execute({sql:"INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'coins','admin_grant',?,?, 'admin',?,?,?)",args:[randomUUID(),String(user.id),reward,Number(credit.rows[0].coins_balance),'promo',String(promo.id),'promo:'+String(promo.id)+':'+String(user.id)+':'+(Number(used.rows[0]?.n??0)+1),JSON.stringify({source:'promo_code',code})]});
      }else{await tx.rollback();return fail('promo_type_invalid',409);}
      await tx.execute({sql:'INSERT INTO promo_redemptions(id,promo_id,telegram_id,reward_type,reward_product_id,reward_amount) VALUES(?,?,?,?,?,?)',args:[randomUUID(),String(promo.id),String(user.id),type,productId||null,type==='coins'?Number(promo.reward_coins):0]});
      await tx.execute({sql:'UPDATE promo_codes SET total_uses=total_uses+1,updated_at=CURRENT_TIMESTAMP WHERE id=?',args:[String(promo.id)]});
      await tx.commit();
      return NextResponse.json({ok:true,type,productId:productId||null,rewardCoins:type==='coins'?Number(promo.reward_coins):0},{headers:{'Cache-Control':'no-store'}});
    }catch(error){await tx.rollback();throw error;}
  }catch(error){console.error('promo_redemption_failed',error);return fail('promo_redemption_failed',503);}
}
