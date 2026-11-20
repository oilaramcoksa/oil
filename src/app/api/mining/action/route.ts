import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseSchema, getTurso } from '@/lib/turso';
import { verifiedPlayerFromRequest } from '@/lib/telegram-player';
import { PACKAGES } from '@/lib/wallets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CYCLE_MS = 12 * 60 * 60 * 1000;
const COINS_PER_OIL = 5;

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const user = verifiedPlayerFromRequest(req);
  if (!user) return fail('telegram_auth_required', 401);
  let body: { action?: unknown; idempotencyKey?: unknown };
  try { body = await req.json(); } catch { return fail('invalid_body'); }
  const action = body.action === 'tick' ? 'tick' : body.action === 'tap' ? 'tap' : '';
  const requestKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
  if (!action || !/^[a-zA-Z0-9:_-]{12,120}$/.test(requestKey)) return fail('invalid_request');

  try {
    await ensureDatabaseSchema();
    const db = getTurso();
    const id = String(user.id);
    const tx = await db.transaction('write');
    try {
      const player = await tx.execute({sql:"SELECT status,mining_fee_paid_at,fee_exempt FROM players WHERE telegram_id=?",
        args:[id]});
      if (!player.rows.length || String(player.rows[0].status) !== 'active') {
        await tx.rollback(); return fail('player_not_active',403);
      }
      if (!player.rows[0].mining_fee_paid_at && Number(player.rows[0].fee_exempt ?? 0) !== 1) {
        await tx.rollback(); return fail('mining_activation_required',403);
      }
      const duplicate = await tx.execute({sql:'SELECT balance_after FROM ledger_entries WHERE idempotency_key=? AND telegram_id=?',
        args:[`oil_mining:${id}:${requestKey}`,id]});
      if (duplicate.rows.length) {
        const [w,c] = await Promise.all([
          tx.execute({sql:'SELECT oil_balance,coins_balance FROM player_wallets WHERE telegram_id=?',args:[id]}),
          tx.execute({sql:'SELECT cycle_ends_at FROM player_game_state WHERE telegram_id=?',args:[id]})
        ]);
        await tx.commit();
        return NextResponse.json({ok:true,duplicate:true,oil:Number(w.rows[0]?.oil_balance??0),coins:Number(w.rows[0]?.coins_balance??0),cycleEndsAt:Number(c.rows[0]?.cycle_ends_at??0)||null},{headers:{'Cache-Control':'no-store'}});
      }

      await tx.execute(`CREATE TABLE IF NOT EXISTS player_product_controls (id TEXT PRIMARY KEY,telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,product_id TEXT NOT NULL,product_type TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',speed_multiplier REAL NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(telegram_id,product_id,product_type))`);
      const [game,wallet,parts,upgrades,controls,specialParts] = await Promise.all([
        tx.execute({sql:'SELECT base_oil_per_tap,base_capacity,cycle_started_at,cycle_ends_at,last_tick_at FROM player_game_state WHERE telegram_id=?',args:[id]}),
        tx.execute({sql:'SELECT oil_balance,coins_balance FROM player_wallets WHERE telegram_id=?',args:[id]}),
        tx.execute({sql:'SELECT part_id,quantity FROM player_parts WHERE telegram_id=?',args:[id]}),
        tx.execute({sql:"SELECT package_id FROM player_upgrades WHERE telegram_id=? AND status='active' AND expires_at>CURRENT_TIMESTAMP",args:[id]}),
        tx.execute({sql:'SELECT product_id,product_type,status,speed_multiplier FROM player_product_controls WHERE telegram_id=?',args:[id]}),
        tx.execute({sql:'SELECT part_id,MAX(expires_at) AS expires_at FROM player_special_parts WHERE telegram_id=? AND (expires_at IS NULL OR expires_at>?) GROUP BY part_id',args:[id,Date.now()]})
      ]);
      if (!game.rows.length || !wallet.rows.length) { await tx.rollback(); return fail('mining_state_missing',409); }
      const g=game.rows[0], w=wallet.rows[0];
      const now=Date.now();
      const feePaidAt=player.rows[0].mining_fee_paid_at
        ? Date.parse(String(player.rows[0].mining_fee_paid_at).replace(' ','T')+'Z')
        : 0;
      const cycleEnd=Number(g.cycle_ends_at??0);
      const cycleStart=Number(g.cycle_started_at??0);
      const lastTick=Number(g.last_tick_at??0);
      const quantities:Record<string,number>={oil_pump:0,fuel_station:0,oil_truck:0};
      for(const p of parts.rows) quantities[String(p.part_id)]=Math.max(0,Number(p.quantity??0));
      const controlMap = new Map(controls.rows.map(r => [String(r.product_type)+':'+String(r.product_id), r]));
      const activePackages=upgrades.rows.map(r=>PACKAGES.find(p=>p.id===String(r.package_id))).filter(p=>{
        const control=controlMap.get('package:'+String(p?.id));
        return !!p && String(control?.status ?? 'active') === 'active';
      });
      const packageTap=activePackages.reduce((n,p)=>{const control=controlMap.get('package:'+String(p!.id));return n+Number(p!.oilPerTap??0)*Math.max(0,Math.min(100,Number(control?.speed_multiplier??1)));},0);
      const packageRate=activePackages.reduce((n,p)=>{const control=controlMap.get('package:'+String(p!.id));return n+Number(p!.perHour??0)*Math.max(0,Math.min(100,Number(control?.speed_multiplier??1)));},0);
      const packageCapacity=activePackages.reduce((n,p)=>{const control=controlMap.get('package:'+String(p!.id));return n+250*Math.max(0,Math.min(100,Number(control?.speed_multiplier??1)));},0);
      const partMultiplier=(partId:string)=> {
        const control=controlMap.get('part:'+partId);
        return String(control?.status ?? 'active') === 'active'
          ? Math.max(0,Math.min(100,Number(control?.speed_multiplier ?? 1))) : 0;
      };
      const specialOwned = new Set(specialParts.rows.map(row => String(row.part_id)));
      const productionMultiplier =
        (1 + (3 - 1) * (quantities.oil_pump > 0 ? partMultiplier('oil_pump') : 0)) *
        (1 + (2 - 1) * (quantities.fuel_station > 0 ? partMultiplier('fuel_station') : 0)) *
        (1 + (1.5 - 1) * (quantities.oil_truck > 0 ? partMultiplier('oil_truck') : 0)) *
        (specialOwned.has('new_background') ? 1.5 : 1) *
        (specialOwned.has('vip_badge') ? 5 : 1);
      const capacity=Number(g.base_capacity??500)+packageCapacity+quantities.fuel_station*250*partMultiplier('fuel_station');
      const upgradeTap=packageTap;
      const perTap=Math.max(1,Math.floor((Number(g.base_oil_per_tap??2)+upgradeTap)*productionMultiplier));
      const rateCoinsHour=(60+packageRate+quantities.oil_truck*30*partMultiplier('oil_truck'))*productionMultiplier;
      let oil=Number(w.oil_balance??0);
      let coins=Number(w.coins_balance??0);
      let currentCycleEnd=cycleEnd;
      let currentCycleStart=cycleStart;
      let currentTick=lastTick;
      // Recover players activated by the previous release, which wrote an already-expired
      // 12-hour cycle marker. Only clear that exact activation marker when no oil remains.
      const legacyActivationCycle = action==='tap' && oil===0 && feePaidAt>0 &&
        Math.abs(cycleEnd-feePaidAt)<=5000 &&
        Math.abs(cycleStart-(feePaidAt-CYCLE_MS))<=5000;
      if(legacyActivationCycle){
        currentCycleStart=0;
        currentCycleEnd=0;
        currentTick=0;
      }
      const insertOil=async(amount:number,key:string,type:string,metadata:Record<string,unknown>)=>{
        if(amount<=0)return;
        oil+=amount;
        await tx.execute({sql:'UPDATE player_wallets SET oil_balance=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',args:[oil,id]});
        await tx.execute({sql:"INSERT INTO ledger_entries(id,telegram_id,asset,entry_type,amount,balance_after,reference_type,reference_id,idempotency_key,metadata_json) VALUES(?,?,'oil',?,?,?,'mining',?,?,?)",
          args:[randomUUID(),id,type,amount,oil,key,requestKey,JSON.stringify(metadata)]});
        await tx.execute({sql:'INSERT INTO player_events(id,telegram_id,event_type,amount,metadata_json,idempotency_key) VALUES(?,?,?,?,?,?)',
          args:[randomUUID(),id,type,amount,JSON.stringify(metadata),`event:${key}`]});
      };

      if(action==='tap'){
        if(!currentCycleEnd || now>=currentCycleEnd){
          if(currentCycleEnd){
            const sold=await tx.execute({sql:'SELECT 1 FROM ledger_entries WHERE telegram_id=? AND (idempotency_key LIKE ? OR idempotency_key=?) LIMIT 1',args:[id,`oil_sale_cycle:${id}:${currentCycleEnd}:coins%`,`oil_sale_cycle:${currentCycleEnd}:coins`]});
            if(!sold.rows.length){await tx.rollback();return fail('previous_cycle_must_be_sold',409);}
          }
          if(oil>0){await tx.rollback();return fail('oil_must_be_sold_before_new_cycle',409);}
          currentCycleStart=now; currentCycleEnd=now+CYCLE_MS; currentTick=now;
        }
        if(now>=currentCycleEnd){await tx.rollback();return fail('mining_cycle_ended',409);}
        // Settle passive output first, using only server-side time and owned upgrades.
        if(currentTick>0 && now>currentTick && oil<capacity){
          const elapsed=Math.min(now,currentCycleEnd)-currentTick;
          const passive=Math.min(capacity-oil,Math.max(0,Math.round(elapsed/3600000*rateCoinsHour/COINS_PER_OIL)));
          if(passive>0) await insertOil(passive,`oil_passive:${id}:${currentCycleEnd}:${currentTick}`,'oil_passive',{cycleEndsAt:currentCycleEnd,from:currentTick,to:Math.min(now,currentCycleEnd)});
        }
        const added=Math.min(capacity-oil,perTap);
        if(added>0) await insertOil(added,`oil_mining:${id}:${requestKey}`,'oil_tap',{cycleEndsAt:currentCycleEnd,perTap,capacity});
        await tx.execute({sql:'UPDATE player_game_state SET cycle_started_at=?,cycle_ends_at=?,last_tick_at=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',
          args:[currentCycleStart,currentCycleEnd,now,id]});
      } else {
        if(!currentCycleEnd || !currentTick){await tx.rollback();return fail('mining_cycle_not_started',409);}
        const until=Math.min(now,currentCycleEnd);
        if(until>currentTick && oil<capacity){
          const elapsed=until-currentTick;
          const produced=Math.min(capacity-oil,Math.max(0,Math.round(elapsed/3600000*rateCoinsHour/COINS_PER_OIL)));
          if(produced>0) await insertOil(produced,`oil_passive:${id}:${currentCycleEnd}:${currentTick}`,'oil_passive',{cycleEndsAt:currentCycleEnd,from:currentTick,to:until});
        }
        currentTick=until;
        await tx.execute({sql:'UPDATE player_game_state SET last_tick_at=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?',args:[currentTick,id]});
      }
      await tx.commit();
      return NextResponse.json({ok:true,action,oil,coins,oilAdded:oil-Number(w.oil_balance??0),capacity,perTap,cycleEndsAt:currentCycleEnd||null,cycleStarted:action==='tap'&&cycleStart!==currentCycleStart},{headers:{'Cache-Control':'no-store'}});
    } catch(error){await tx.rollback();throw error;}
  } catch(error){
    console.error('server_mining_failed',error);
    return fail('server_mining_unavailable',503);
  }
}
