'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, Dices, History, Loader2, Users, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useGame } from '@/lib/store';
import { t } from '@/lib/i18n';

type Entry={telegramId:string;username:string;amount:number};
type Round={id:string;status:'open'|'countdown'|'spinning'|'completed'|'cancelled';startsAt:number|null;spinStartedAt:number|null;totalEntries:number;entriesCount:number;winnerType:string|null;winnerTelegramId:string|null};
type State={round:Round|null;balance:number;entries:Entry[]};

export function ArenaScreen({initData,isVerified}:{initData:string;isVerified:boolean}) {
 const lang=useGame(s=>s.lang);
 const userId=useGame(s=>s.userId);
 const localCoins=useGame(s=>s.coins);
 const [state,setState]=useState<State>({round:null,balance:0,entries:[]});
 const [amount,setAmount]=useState('1000');
 const [loading,setLoading]=useState(false);
 const [remaining,setRemaining]=useState(0);
 const [now,setNow]=useState(Date.now());
 const [lastResult,setLastResult]=useState<{winnerType:string;winnerTelegramId:string|null}|null>(null);
 const headers=useMemo(()=>({'X-Telegram-Init-Data':initData}),[initData]);

 const refresh=useCallback(async()=>{
  if(!isVerified||!initData)return;
  const response=await fetch('/api/arena',{headers,cache:'no-store'});
  if(!response.ok)throw new Error('arena_state_failed');
  const data=await response.json() as State;
  setState(data);
  if(data.round?.status==='completed'||data.round?.status==='cancelled') {
   setLastResult({winnerType:data.round.winnerType||'house',winnerTelegramId:data.round.winnerTelegramId});
  }
 },[headers,initData,isVerified]);

 useEffect(()=>{
  if(!isVerified)return;
  let stopped=false;
  const poll=async()=>{try{await refresh();}catch(e){console.error(e);}};
  void poll();
  const timer=window.setInterval(()=>{if(!stopped)void poll();},1000);
  return()=>{stopped=true;window.clearInterval(timer);};
 },[isVerified,refresh]);

 useEffect(()=>{
  const timer=window.setInterval(()=>{setNow(Date.now());},250);
  return()=>window.clearInterval(timer);
 },[]);
 useEffect(()=>{
  const start=state.round?.startsAt;
  if(!start){setRemaining(0);return;}
  setRemaining(Math.max(0,Math.ceil((start-now)/1000)));
 },[state.round?.startsAt,now]);

 const join=async()=>{
  const n=Number(amount);
  if(!Number.isSafeInteger(n)||n<1000){toast.error(t(lang,'arenaMin'));return;}
  setLoading(true);
  try{
   const response=await fetch('/api/arena',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({amount:n})});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||'arena_join_failed');
   setAmount('1000');
   toast.success(t(lang,'arenaJoined'));
   await refresh();
   // Force wallet mirror to reflect the server balance, not a guessed local decrement.
   useGame.setState({coins:data.balance});
  }catch(e){
   const msg=e instanceof Error?e.message:'';
   toast.error(msg==='insufficient_balance'?t(lang,'arenaError'):t(lang,'arenaError'));
  }finally{setLoading(false);}
 };

 const round=state.round;
 const entries=state.entries;
 const total=entries.reduce((s,e)=>s+e.amount,0);
 const maxStake=Math.max(0,state.balance);
 const wheelEntries=[{id:'house',label:t(lang,'arenaAdminSlice'),weight:25,house:true},...entries.map(e=>({id:e.telegramId,label:e.username,weight:75*(e.amount/Math.max(total,1)),house:false}))];
 const wheelGradient=useMemo(()=>{
  let current=0;
  const stops=wheelEntries.map((e,i)=>{
   const start=current; current+=e.weight;
   return `${['#1545f0','#ff9d4b','#7c3aed','#00b98b','#f43f5e','#0ea5e9'][i%6]} ${start}% ${current}%`;
  });
  return `conic-gradient(from -90deg,${stops.join(',')})`;
 },[entries.map(e=>e.telegramId+':'+e.amount).join('|'),lang]);
 const isSpinning=round?.status==='spinning';
 const rotation=isSpinning?360*8+180:0;
 const ownEntry=entries.some(e=>e.telegramId===String(userId));
 const balance=state.balance||localCoins;

 return <div className="h-full overflow-y-auto bg-[#171719] text-white px-3 pt-4 pb-6" dir={lang==='ar'?'rtl':'ltr'}>
  <div className="max-w-md mx-auto">
   <header className="flex items-center justify-between mb-4">
    <div><h2 className="text-xl font-black tracking-tight">{t(lang,'arenaTitle')}</h2><p className="text-xs text-zinc-400 mt-1">{t(lang,'arenaSubtitle')}</p></div>
    <button onClick={()=>void refresh()} className="w-10 h-10 rounded-xl border border-white/10 bg-white/5 grid place-items-center"><History size={18}/></button>
   </header>
   <div className="grid grid-cols-3 gap-2 mb-3">
    {['LOW','MED','HIGH'].map((label,i)=><div key={label} className={`rounded-xl p-2 border ${i===0?'border-orange-400/70 bg-orange-500/10':'border-white/10 bg-white/[.04]'}`}><div className="flex justify-between text-xs font-black"><span>{label}</span><span className="text-emerald-400">●</span></div><div className="text-[10px] text-emerald-400 mt-1">OPEN</div><div className="text-[10px] text-zinc-400 mt-1 flex justify-between"><span><Users size={11} className="inline"/> {entries.length}</span><span>🪙 {total.toLocaleString()}</span></div></div>)}
   </div>
   <div className="grid grid-cols-3 gap-2 mb-3">
    {entries.slice(0,3).map((e,i)=><div key={e.telegramId} className="rounded-xl bg-white/[.06] border border-white/10 p-2 min-w-0"><div className="text-[11px] font-bold truncate">{e.username}</div><div className="text-xs font-black text-emerald-400 mt-1">+{e.amount.toLocaleString()}</div><div className="text-[9px] text-zinc-500">{t(lang,'arenaOdds')}: {(75*e.amount/Math.max(total,1)).toFixed(1)}%</div></div>)}
    </div>
   <div className="relative mx-auto my-3 w-[min(78vw,360px)] aspect-square">
    <div className="absolute z-20 left-1/2 -translate-x-1/2 -top-1 text-3xl text-white drop-shadow-lg">▼</div>
    <motion.div animate={{rotate:rotation}} transition={{duration:7,ease:[.12,.75,.12,1]}} className="absolute inset-0 rounded-full border-[7px] border-[#292a32] shadow-[0_0_0_2px_rgba(255,255,255,.05),0_20px_45px_rgba(0,0,0,.45)]" style={{background:wheelGradient}}>
     {wheelEntries.map((e,i)=>{
      const angle=wheelEntries.slice(0,i).reduce((s,x)=>s+x.weight,0)+e.weight/2-90;
      return <div key={e.id} className="absolute left-1/2 top-1/2 text-center text-[10px] font-black" style={{transform:`rotate(${angle}deg) translateY(-${Math.max(45,Math.min(125,120-e.weight/3))}px) rotate(-${angle}deg) translate(-50%,-50%)`,width:80}}><span className="inline-block max-w-full truncate rounded bg-black/50 px-1.5 py-1">{e.house?'🔥':e.label}</span>{!e.house&&<span className="block text-[9px]">{e.weight.toFixed(1)}%</span>}</div>;
     })}
    </motion.div>
    <div className="absolute z-10 inset-[34%] rounded-full bg-[#17191f] border-[4px] border-white shadow-[0_4px_18px_rgba(0,0,0,.65)] flex flex-col items-center justify-center">
     <div className="text-2xl font-black tabular-nums">{round?.status==='countdown'?String(remaining).padStart(2,'0')+':00':isSpinning?'00:00':t(lang,'arenaWaiting')}</div>
     <div className="text-[10px] text-zinc-400 mt-1"><Users size={11} className="inline"/> {entries.length}</div>
    </div>
   </div>
   <div className="rounded-xl bg-white/[.04] border border-white/10 p-3 mb-3">
    <div className="flex justify-between items-center text-xs text-zinc-400 mb-2"><span className="flex items-center gap-1"><Coins size={13}/> {t(lang,'arenaPot')}</span><strong className="text-amber-400 text-base">{total.toLocaleString()}</strong></div>
    <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-blue-500" style={{width:'75%'}}/></div>
    <div className="flex justify-between text-[10px] text-zinc-400 mt-2"><span>{t(lang,'arenaAdminSlice')}</span><span>25%</span></div>
    <div className="text-[10px] text-zinc-500 mt-1">{t(lang,'arenaAdminNote')}</div>
   </div>
   <div className="rounded-xl bg-white/[.04] border border-white/10 p-3 mb-3">
    <div className="flex justify-between text-xs text-zinc-400 mb-2"><span>{t(lang,'arenaBalance')}</span><b className="text-amber-400">{balance.toLocaleString()}</b></div>
    <label className="text-xs text-zinc-300">{t(lang,'arenaAmount')}</label>
    <div className="flex gap-2 mt-2">
     <input type="number" inputMode="numeric" min="1000" step="1" value={amount} onChange={e=>setAmount(e.target.value)} disabled={ownEntry||!!round?.startsAt||isSpinning} className="flex-1 min-w-0 rounded-lg bg-[#25262a] border border-white/10 p-3 font-black outline-none focus:border-blue-500"/>
     <button onClick={()=>setAmount(String(maxStake))} className="px-3 rounded-lg bg-white/10 text-xs font-black">{t(lang,'arenaMax')}</button>
    </div>
    <button disabled={loading||!isVerified||ownEntry||!!round?.startsAt||isSpinning||Number(amount)<1000||Number(amount)>balance} onClick={()=>void join()} className="w-full mt-3 rounded-lg bg-[#ff9f50] disabled:opacity-40 text-[#24180f] font-black py-3 flex items-center justify-center gap-2">
     {loading?<Loader2 className="animate-spin" size={16}/>:<Zap size={16}/>} {t(lang,'arenaJoin')} · {Number(amount||0).toLocaleString()}
    </button>
    <p className="text-[10px] text-zinc-500 mt-2">{t(lang,'arenaMin')} · {t(lang,'arenaRules')}</p>
   </div>
   <section className="rounded-xl bg-white/[.04] border border-white/10 p-3">
    <h3 className="text-sm font-black mb-2">{t(lang,'arenaPlayers')}</h3>
    {entries.length===0?<div className="text-center text-xs text-zinc-500 py-4">{t(lang,'arenaNoRound')}</div>:entries.map(e=><div key={e.telegramId} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"><span className="text-xs font-bold truncate">{e.username}{e.telegramId===String(userId)?' · '+t(lang,'arenaYou'):''}</span><b className="text-xs text-amber-400">{e.amount.toLocaleString()}</b></div>)}
   </section>
   {lastResult&&<div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm font-bold">{lastResult.winnerType==='house'?t(lang,'arenaAdminWon'):t(lang,'arenaPlayerWon')}</div>}
  </div>
 </div>;
}
