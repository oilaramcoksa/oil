'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Coins, Loader2, History, Timer, Trophy, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useGame } from '@/lib/store';

type Color = 'yellow' | 'purple' | 'turquoise';
type Bet = { telegramId: string; username: string; photoUrl: string | null; color: Color; amount: number; payout: number; outcome: string };
type Winner = { telegramId: string; username: string; photoUrl: string | null; payout: number; color: Color; roundId: string };
type RoundHistory = { id: string; color: Color; sector: number; betsCount: number; total: number; completedAt: string };
type WheelState = { round: { id: string; status: 'open' | 'spinning' | 'completed'; startsAt: number | null; spinStartedAt: number | null; winningSector: number | null; winningColor: Color | null }; balance: number; bets: Bet[]; ownBet: Bet | null; winners: Winner[]; history: RoundHistory[]; serverNow: number };

const COLORS: Color[] = ['yellow','purple','yellow','purple','yellow','purple','yellow','turquoise','purple','yellow','purple','yellow','purple','yellow','purple'];
const META: Record<Color,{label:string;multiplier:string;className:string;hex:string}> = {
 yellow:{label:'أصفر',multiplier:'×1.95',className:'border-yellow-300/60 bg-yellow-400/10 text-yellow-200',hex:'#f5cf55'},
 purple:{label:'بنفسجي',multiplier:'×1.95',className:'border-violet-300/50 bg-violet-400/10 text-violet-200',hex:'#a98add'},
 turquoise:{label:'فيروزي نادر',multiplier:'×9.5',className:'border-teal-300/60 bg-teal-400/10 text-teal-200',hex:'#65c8b9'},
};
const SECTOR_DEG = 360 / 15;

export function ColorWheelScreen({initData,isVerified,telegramUserId}:{initData:string;isVerified:boolean;telegramUserId:string}) {
 const lang=useGame(s=>s.lang);
 const [state,setState]=useState<WheelState|null>(null);
 const [amount,setAmount]=useState('100');
 const [now,setNow]=useState(Date.now());
 const [loading,setLoading]=useState(false);
 const [rotation,setRotation]=useState(0);
 const [spinDuration,setSpinDuration]=useState(7000);
 const animatedRound=useRef<string|null>(null);
 const headers=useMemo(()=>({'X-Telegram-Init-Data':initData}),[initData]);
 const refresh=useCallback(async()=>{
  if(!initData||!isVerified)return;
  const response=await fetch('/api/color-wheel',{headers,cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'color_wheel_unavailable');
  setState(data as WheelState);
 },[headers,initData,isVerified]);
 useEffect(()=>{void refresh().catch(()=>undefined);const poll=window.setInterval(()=>void refresh().catch(()=>undefined),500);const clock=window.setInterval(()=>setNow(Date.now()),200);return()=>{window.clearInterval(poll);window.clearInterval(clock)}},[refresh]);
 useEffect(()=>{
  const round=state?.round;
  if(!round||round.status!=='spinning'||round.winningSector===null||animatedRound.current===round.id)return;
  animatedRound.current=round.id;
  const remaining=Math.max(500,Math.min(7000,(round.spinStartedAt??Date.now())+7000-Date.now()));
  setSpinDuration(remaining);
  const center=round.winningSector*SECTOR_DEG+SECTOR_DEG/2;
  const target=((360-center)%360);
  setRotation(current=>current+360*8+target);
 },[state?.round?.id,state?.round?.status,state?.round?.winningSector,state?.round?.spinStartedAt]);
 const countdown=state?.round.startsAt?Math.max(0,Math.ceil((state.round.startsAt-now)/1000)):15;
 const isSpinning=state?.round.status==='spinning';
 const placeBet=async(color:Color)=>{
  const value=Number(amount);
  if(!Number.isSafeInteger(value)||value<100){toast.error('الحد الأدنى للرهان 100');return}
  if(!state||state.ownBet||loading||state.round.status!=='open'||(state.round.startsAt!==null&&state.round.startsAt<=Date.now()))return;
  setLoading(true);
  try{
   const response=await fetch('/api/color-wheel',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({amount:value,color}),cache:'no-store'});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||'bet_failed');
   await refresh();
   toast.success('تم تسجيل رهانك');
  }catch(error){
   const code=error instanceof Error?error.message:'';
   toast.error(code==='insufficient_balance'?'رصيدك غير كافٍ':code==='already_bet'?'لقد راهنت في هذه الجولة بالفعل':code==='betting_closed'?'انتهى وقت الرهان':'تعذر تسجيل الرهان');
   await refresh().catch(()=>undefined);
  }finally{setLoading(false)}
 };
 const presets=[{label:'½',value:Math.max(100,Math.floor(Number(amount||100)/2))},{label:'×2',value:Math.max(100,Number(amount||100)*2)},{label:'MAX',value:state?.balance??0}];
 const history=state?.history??[];
 const ownBet=state?.ownBet;
 const canBet=Boolean(state&&isVerified&&!ownBet&&!loading&&state.round.status==='open'&&(state.round.startsAt===null||state.round.startsAt>Date.now()));
 const wheelGradient=useMemo(()=>`conic-gradient(from -12deg,${COLORS.map((color,index)=>`${META[color].hex} ${index*24}deg ${(index+1)*24}deg`).join(',')})`,[]);
 const rotationStyle={transform:`rotate(${rotation}deg)`,transition:isSpinning?`transform ${spinDuration}ms cubic-bezier(.10,.78,.08,1)`:'none'};
 return <div className="h-full min-h-0 overflow-y-auto overscroll-contain bg-[#191b1d] px-3 pb-6 pt-3 text-white" dir={lang==='ar'?'rtl':'ltr'}>
  <div className="mx-auto w-full max-w-md space-y-3">
   <section className="rounded-2xl border border-white/10 bg-[#25282b] p-3 shadow-lg">
    <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-black text-white/65"><Trophy size={15} className="text-amber-300"/> آخر فائزين</div><span className="text-[10px] text-white/35">ARMCO OIL</span></div>
    <div className="grid grid-cols-2 gap-2">
     {[0,1].map(index=>{const winner=state?.winners[index];return <div key={winner?.roundId??index} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
      {winner?.photoUrl?<img src={winner.photoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover"/>:<div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-black">{winner?.username?.slice(0,1)??'?'}</div>}
      <div className="min-w-0 flex-1"><div className="truncate text-[11px] font-bold">{winner?.username??'بانتظار فائز'}</div><div className="text-[9px] text-white/40">فاز بالجولة</div></div>
      <b className="shrink-0 text-[11px] text-amber-300">+{(winner?.payout??0).toLocaleString()}</b>
     </div>})}
    </div>
   </section>
   <section className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#292b2d] to-[#17191b] p-3 shadow-[0_16px_36px_rgba(0,0,0,.28)]">
    <div className="mb-2 flex items-center justify-between"><span className="text-xs font-black text-white/75">عجلة الألوان</span><span className="text-[10px] text-white/35">15 خانة · خانة نادرة واحدة</span></div>
    <div className="relative mx-auto aspect-square w-full max-w-[390px] p-1">
     <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[#f9e3a2] via-[#8b7541] to-[#1d2023] p-[7px] shadow-[0_15px_32px_rgba(0,0,0,.55)]">
      <div className="h-full w-full rounded-full bg-[#101214] p-[5px] shadow-[inset_0_0_0_3px_rgba(255,255,255,.15)]">
       <motion.div className="relative h-full w-full rounded-full border-[3px] border-[#5d5e5f] shadow-[inset_0_0_0_2px_rgba(0,0,0,.4)]" style={{...rotationStyle,background:wheelGradient}}>
        <div className="absolute inset-0 rounded-full" style={{background:'repeating-conic-gradient(from -12deg, transparent 0deg 23.35deg, rgba(22,22,22,.85) 23.35deg 24deg)'}}/>
        {COLORS.map((color,index)=>{const angle=(index*24+12)*Math.PI/180;const x=50+34*Math.sin(angle);const y=50-34*Math.cos(angle);return <span key={index} className="absolute h-1.5 w-1.5 rounded-full bg-white/50 shadow" style={{left:x+'%',top:y+'%'}}/>})}
       </motion.div>
      </div>
     </div>
     <div className="absolute -top-0.5 left-1/2 z-20 -translate-x-1/2 drop-shadow-[0_3px_5px_rgba(0,0,0,.8)]"><div className="h-0 w-0 border-x-[15px] border-t-[28px] border-x-transparent border-t-orange-400"/></div>
     <div className="absolute left-1/2 top-1/2 z-10 flex h-[35%] w-[35%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-[5px] border-[#47494b] bg-[radial-gradient(circle_at_35%_30%,#34383c,#111315_70%)] shadow-[0_4px_18px_rgba(0,0,0,.7),inset_0_2px_8px_rgba(255,255,255,.08)]">
      <span className="text-4xl font-black tabular-nums text-white drop-shadow-lg">{isSpinning?'':countdown}</span>
      <span className="mt-1 text-[9px] font-bold text-white/45">{isSpinning?'تدور الآن':state?.round.startsAt===null?'بانتظار أول لاعب':'العد التنازلي'}</span>
     </div>
    </div>
    <div className="mt-1 flex items-center justify-center gap-2 text-[10px] text-white/50"><Timer size={12}/>{isSpinning?'تحديد اللون الفائز...':state?.round.startsAt===null?'ضع أول رهان لبدء الجولة':'تُغلق الرهانات عند انتهاء العداد'}</div>
   </section>
   <section className="rounded-2xl border border-white/10 bg-[#222528] p-3">
    <div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-xs font-black text-white/75"><History size={14}/> نتائج الجولات السابقة</h3><span className="text-[10px] text-white/35">{history.length}</span></div>
    <div className="flex flex-wrap gap-2">
     {history.length?history.map(item=><div key={item.id} title={item.color} className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 shadow-inner" style={{background:META[item.color].hex}}><span className="text-[9px] font-black text-black/65">{item.sector+1}</span></div>):<span className="py-2 text-[11px] text-white/35">ستظهر النتائج بعد اكتمال أول جولة</span>}
    </div>
   </section>
   <section className="rounded-2xl border border-white/10 bg-[#222528] p-3">
    <div className="mb-2 flex items-center justify-between text-xs"><span className="text-white/55">رصيدك</span><b className="flex items-center gap-1 text-amber-300"><Coins size={13}/>{(state?.balance??0).toLocaleString()}</b></div>
    <div className="flex gap-2">
     <input type="number" min={100} step={1} inputMode="numeric" value={amount} onChange={event=>setAmount(event.target.value)} disabled={!canBet} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#171a1c] px-3 py-3 text-lg font-black text-white outline-none focus:border-amber-400 disabled:opacity-60"/>
     {presets.map(item=><button key={item.label} type="button" disabled={!canBet||item.value>(state?.balance??0)} onClick={()=>setAmount(String(item.value))} className="min-w-11 rounded-xl border border-white/10 bg-[#2a2e31] px-2 text-xs font-black text-white/65 disabled:opacity-30">{item.label}</button>)}
    </div>
    {ownBet&&<div className="mt-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-2 text-xs font-bold text-emerald-200">رهانك: {ownBet.amount.toLocaleString()} على {META[ownBet.color].label} · {isSpinning?'الجولة تدور':'تم تسجيل الرهان'}</div>}
    <div className="mt-3 grid grid-cols-3 gap-2">
     {(['yellow','turquoise','purple'] as Color[]).map(color=><button key={color} type="button" disabled={!canBet||Number(amount)<100||Number(amount)>(state?.balance??0)} onClick={()=>void placeBet(color)} className={'relative flex min-h-[102px] flex-col items-center justify-center rounded-2xl border p-2 transition active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-35 '+META[color].className}>
      <span className="mb-1 h-9 w-9 rounded-full border-4 border-white/20 shadow-[0_0_18px_currentColor] " style={{background:META[color].hex}}/>
      <b className="text-xs">{META[color].label}</b><span className="mt-1 text-lg font-black">{META[color].multiplier}</span>
      <span className="text-[9px] opacity-65">{color==='turquoise'?'فرصة نادرة':'معامل الربح'}</span>
     </button>)}
    </div>
    <p className="mt-2 text-center text-[9px] text-white/35">رهان واحد لكل لاعب في الجولة · الحد الأدنى 100 عملة</p>
   </section>
  </div>
 </div>;
}
