'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PumpScene3D, type PumpScene3DHandle } from '../PumpScene3D';
import { SellModal } from '../SellModal';
import { Button } from '@/components/ui/button';
import { Droplet, Gauge, ArrowUpRight, Clock, Power, Package } from 'lucide-react';
import {
  useGame,
  effectiveCapacity,
  effectiveOilPerTap,
  effectiveCoinsPerHour,
  isCycleActive,
  cycleSecondsRemaining,
  CYCLE_SECONDS,
} from '@/lib/store';
import { t } from '@/lib/i18n';
import { useTelegram } from '@/hooks/use-telegram';
import { HybridRewardedAd } from '@/components/aram/HybridRewardedAd';
import { toast } from 'sonner';
import { MiningFeeGate } from '@/components/aram/MiningFeeGate';
import { watchMonetagRewardedAd } from '@/lib/monetag-reward';

interface Props {
  onGoToStore: () => void;
  onGoToArena: () => void;
  initData: string;
  isVerified: boolean;
  onOpenShorts: () => void;
}

export function PumpScreen({ onGoToStore, onGoToArena, onOpenShorts, initData, isVerified }: Props) {
  const lang = useGame((s) => s.lang);
  const oil = useGame((s) => s.oil);
  const [feeActivated, setFeeActivated] = useState(false);
  const [feeStatusReady, setFeeStatusReady] = useState(false);
  const [feeGateOpen, setFeeGateOpen] = useState(false);
  const coins = useGame((s) => s.coins);
  const baseOilPerTap = useGame((s) => s.baseOilPerTap);
  const upgrades = useGame((s) => s.upgrades);
  const parts = useGame((s) => s.parts);
  const specialParts = useGame((s) => s.specialParts);
  const cycleEndsAt = useGame((s) => s.cycleEndsAt);
  const applyServerAdReward = useGame((s) => s.applyServerAdReward);
  const { haptic, notify } = useTelegram();

  const [sellOpen, setSellOpen] = useState(false);
  const [shortsVisible, setShortsVisible] = useState(false);
  const [floats, setFloats] = useState<{ id: number; v: number }[]>([]);
  const fidRef = useRef(0);
  const actionAdBusyRef = useRef(false);
  const sceneRef = useRef<PumpScene3DHandle>(null);

  // Contest visibility is controlled centrally by the admin API.
  useEffect(() => {
    let disposed = false;
    const check = async () => {
      try {
        const response = await fetch('/api/shorts-contest?mode=status', { cache: 'no-store' });
        if (!response.ok) throw new Error('contest_status_unavailable');
        const data = await response.json() as { visible?: boolean };
        if (!disposed) setShortsVisible(data.visible === true);
      } catch {
        if (!disposed) setShortsVisible(false);
      }
    };
    void check();
    const id = window.setInterval(() => void check(), 10_000);
    return () => { disposed = true; window.clearInterval(id); };
  }, []);

  // Mining production is settled by the server; the browser only refreshes its authoritative result.
  const refreshMining = useCallback(async (action: 'tap' | 'tick') => {
    const response = await fetch('/api/mining/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({ action, idempotencyKey: crypto.randomUUID() }),
      cache: 'no-store',
    });
    const data = await response.json() as { ok?: boolean; error?: string; oil?: number; coins?: number; cycleEndsAt?: number | null; oilAdded?: number; cycleStarted?: boolean; capacity?: number };
    if (!response.ok || data.ok !== true) throw new Error(data.error || 'mining_unavailable');
    useGame.setState({
      oil: Number(data.oil ?? 0),
      coins: Number(data.coins ?? useGame.getState().coins),
      cycleEndsAt: data.cycleEndsAt ?? null,
      lastTickAt: Date.now(),
    });
    return data;
  }, [initData]);

  useEffect(() => {
    let disposed = false;
    const tick = async () => {
      try { await refreshMining('tick'); } catch { /* Keep the last server-confirmed state during transient outages. */ }
    };
    void tick();
    const id = window.setInterval(() => { if (!disposed) void tick(); }, 5000);
    return () => { disposed = true; window.clearInterval(id); };
  }, [refreshMining]);

  // Re-render every second so the countdown updates.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const cap = effectiveCapacity(upgrades);
  const perTap = Math.floor(
    effectiveOilPerTap(upgrades, Date.now(), baseOilPerTap) *
    (parts.oil_pump > 0 ? 3 : 1) *
    (parts.fuel_station > 0 ? 2 : 1) *
    (parts.oil_truck > 0 ? 1.5 : 1) *
    (specialParts.new_background ? 1.5 : 1) *
    (specialParts.vip_badge ? 5 : 1)
  );
  const coinsPerHour = effectiveCoinsPerHour(upgrades);
  const oilRatio = oil / cap;

  const now = Date.now();
  const active = feeActivated && isCycleActive(cycleEndsAt, now);
  const secRem = cycleSecondsRemaining(cycleEndsAt, now);
  const cycleProgress = cycleEndsAt ? (active ? 1 - secRem / CYCLE_SECONDS : 1) : 0;

  const handleFeeActivated = useCallback(() => {
    setFeeGateOpen(false);
    void refreshMining('tap').then((result) => {
      setFeeActivated(true);
      if (result.cycleStarted) notify('success');
      toast.success(lang === 'ar' ? 'تم تفعيل التعدين وبدأت المضخة العمل' : 'Mining activated. The pump is running.');
    }).catch((error) => {
      const code = error instanceof Error ? error.message : 'mining_unavailable';
      if (code === 'oil_must_be_sold_before_new_cycle' || code === 'previous_cycle_must_be_sold') {
        setFeeActivated(true);
        toast.error(lang === 'ar' ? 'لديك نفط متبقٍ من دورة سابقة. بِعه أولاً ثم ابدأ التعدين.' : 'Sell the remaining oil from your previous cycle before starting.');
      } else {
        setFeeActivated(true);
        setFeeGateOpen(false);
        toast.error(lang === 'ar' ? 'تم تفعيل الرسوم، لكن تعذر تشغيل المضخة. اضغط بدء التعدين للمحاولة مجدداً.' : 'Fee activated, but the pump did not start. Tap Start Mining to retry.');
        console.error('pump_activation_start_failed', code);
      }
    });
  }, [refreshMining, notify, lang]);

  useEffect(() => {
    let active = true;
    fetch('/api/mining/activation', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'activation_status_unavailable');
        if (active) {
          const required = data.required === true;
          setFeeActivated(!required);
          setFeeStatusReady(true);
          setFeeGateOpen(required);
          // A paid player resumes the existing server-side cycle silently.
          // "tick" settles elapsed production but never starts a new cycle.
          if (!required) void refreshMining('tick').catch(() => undefined);
        }
      })
      .catch(() => { if (active) setFeeStatusReady(true); });
    return () => { active = false; };
  }, [initData, refreshMining]);

  const performTap = () => {
    haptic('light');
    void refreshMining('tap').then((r) => {
      if (r.cycleStarted) notify('success');
      if (Number(r.oilAdded ?? 0) > 0) {
        const id = ++fidRef.current;
        setFloats((f) => [...f, { id, v: Number(r.oilAdded) }]);
        setTimeout(() => setFloats((x) => x.filter((item) => item.id !== id)), 1000);
      } else if (Number(r.oil ?? 0) >= Number(r.capacity ?? cap)) {
        haptic('heavy');
      }
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'mining_unavailable';
      if (message === 'mining_activation_required') setFeeGateOpen(true);
      else if (message === 'previous_cycle_must_be_sold' || message === 'oil_must_be_sold_before_new_cycle') toast.error(t(lang, 'sell'));
      else { console.error('pump_action_failed', message); toast.error(lang === 'ar' ? 'تعذر تشغيل المضخة الآن. حاول مرة أخرى.' : 'The pump could not start. Please try again.'); }
    });
  };

  const rewardActionAd = async (purpose: 'sell_action' | 'mining_start') => {
    // Sale and mining-start ads each have their own server-side 12-hour window. During the window,
    // continue the requested game action immediately without opening another ad.
    const statusResponse = await fetch('/api/ads/action-reward?purpose=' + purpose, {
      method: 'GET',
      headers: { 'x-telegram-init-data': initData },
      cache: 'no-store',
    });
    if (statusResponse.ok) {
      const status = await statusResponse.json() as { canWatchAd?: boolean };
      if (status.canWatchAd === false) return;
    }
    const result = await watchMonetagRewardedAd({
      initData,
      requestVar: purpose,
      endpoint: '/api/ads/action-reward',
      body: (ymid) => ({ ymid, purpose }),
    });
    applyServerAdReward(result.reward, result.walletCoins);
    toast.success(`+${result.reward} ${t(lang, 'coins')}`);
  };

  const handleTap = () => {
    if (!feeActivated) {
      setFeeGateOpen(true);
      return;
    }
    if (!active && oil > 0) return;
    // Only the first tap that starts a fresh mining cycle is preceded by an ad.
    if (!active && oil <= 0) {
      if (actionAdBusyRef.current) return;
      actionAdBusyRef.current = true;
      void rewardActionAd('mining_start')
        .catch((error) => console.info('monetag_mining_ad_unavailable', error))
        .finally(() => {
          actionAdBusyRef.current = false;
          performTap();
        });
      return;
    }
    performTap();
  };

  const handleSell = () => {
    if (!feeActivated) {
      setFeeGateOpen(true);
      return;
    }
    if (active || oil <= 0 || actionAdBusyRef.current) return;
    actionAdBusyRef.current = true;
    sceneRef.current?.triggerSell();
    haptic('medium');
    void rewardActionAd('sell_action')
      .catch((error) => console.info('monetag_sell_ad_unavailable', error))
      .finally(() => {
        actionAdBusyRef.current = false;
        setSellOpen(true);
      });
  };

  const handleAdRewarded = useCallback((reward: number, walletCoins: number) => {
    applyServerAdReward(reward, walletCoins);
    haptic('medium');
    notify('success');
    toast.success(`${t(lang, 'tadsRewardSuccess')} +${reward} ${t(lang, 'coins')}`);
  }, [applyServerAdReward, haptic, lang, notify]);

  const handleAdRewardError = useCallback((error: string) => {
    // Ad inventory/provider failures are non-blocking and must never interrupt gameplay.
    // Keep diagnostics in the console only; do not expose provider or SDK messages to players.
    console.info('optional_reward_ad_unavailable', error);
  }, []);

  return (
    <div className="relative flex h-full flex-col overflow-y-auto overscroll-contain bg-[#0e1018] pb-3 text-white">
      <div className="mx-auto grid w-full max-w-md grid-cols-2 gap-2 px-3 pt-3 pb-2">
        <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-emerald-400/35 bg-gradient-to-br from-[#292015] to-[#15110d] px-3 py-2 shadow-[0_6px_18px_rgba(0,0,0,.35)]">
          <div className="text-[10px] font-bold text-emerald-200/80">{lang === 'ar' ? 'سرعة التعدين' : 'Mining speed'}</div>
          <div dir="ltr" className="text-lg font-black tabular-nums text-emerald-300">{coinsPerHour.toLocaleString()} <span className="text-[10px] text-emerald-100/65">{lang === 'ar' ? 'عملة/ساعة' : 'coins/hour'}</span></div>
          {specialParts.vip_badge && <div className="w-fit rounded-lg border border-amber-300/60 bg-gradient-to-r from-amber-500/30 to-yellow-300/10 px-2 py-0.5 text-[10px] font-black text-amber-200 shadow-[0_0_12px_rgba(251,191,36,.15)]">👑 VIP</div>}
        </div>
        <div className="flex min-w-0 flex-col justify-center rounded-2xl border border-amber-400/35 bg-gradient-to-br from-[#292015] to-[#15110d] px-3 py-2 shadow-[0_6px_18px_rgba(0,0,0,.35)]">
          <div className="text-[10px] font-bold text-amber-200/80">{t(lang,'coins')}</div>
          <div dir="ltr" className="text-lg font-black tabular-nums text-amber-200">{coins.toLocaleString()}</div>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2 rounded-xl border border-emerald-300/30 bg-[#24182c] px-3 py-2 shadow-lg">
          <span className="text-lg">💵</span>
          <div><div className="text-[9px] font-bold text-emerald-200/70">{t(lang,'coins')}</div><div className="text-sm font-black tabular-nums text-emerald-100">{coins.toLocaleString()}</div></div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={()=>{haptic('medium');onGoToArena();}} aria-label={t(lang,'arenaPromoTitle')} className="grid h-10 w-10 place-items-center rounded-xl border border-amber-300/30 bg-[#382b24] text-xl shadow-lg">🏆</button>
          <button type="button" onClick={()=>{haptic('light');onGoToStore();}} aria-label={t(lang,'upgrade')} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-[#302b36] text-white shadow-lg"><Package className="h-5 w-5"/></button>
        </div>
      </div>

      <div className="game-panel relative mx-auto w-full max-w-md overflow-hidden rounded-t-[26px] border border-violet-200/20 bg-gradient-to-b from-[#242044] via-[#201a38] to-[#130f24] px-1 shadow-[0_18px_38px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.18)]" style={{ perspective: '900px' }}>
        <PumpScene3D ref={sceneRef} pumping={active} oilRatio={oilRatio} onTap={handleTap} parts={parts} specialParts={specialParts}/>
        <div className="pointer-events-none absolute left-[2.5%] top-[16%] z-20 flex w-[27%] max-w-[132px] flex-col gap-2">
          <motion.div
            initial={{ opacity: 0, x: -18, rotateY: 24, scale: .88 }}
            animate={{ opacity: 1, x: 0, rotateY: 7, scale: 1, y: [0, -3, 0] }}
            transition={{ opacity: { duration: .45 }, x: { duration: .45, type: 'spring', stiffness: 150 }, rotateY: { duration: .5 }, y: { duration: 3.2, repeat: Infinity, ease: 'easeInOut' } }}
            className="rounded-xl border border-cyan-200/35 bg-gradient-to-br from-[#252a46]/95 via-[#15172d]/95 to-[#090d20]/95 px-2 py-2 shadow-[0_8px_0_rgba(4,8,24,.8),0_12px_24px_rgba(0,0,0,.48),inset_0_1px_0_rgba(255,255,255,.22)] backdrop-blur-md"
            style={{ transformStyle: 'preserve-3d' }}
          >
            <div className="flex items-center gap-1 text-[9px] font-black leading-tight text-slate-300"><Droplet className="h-3 w-3 shrink-0 text-amber-300 drop-shadow-[0_0_5px_rgba(251,191,36,.8)]"/> <span>{t(lang,'oil')}</span></div>
            <motion.div key={oil.toFixed(5)} initial={{ scale: 1.12, color: '#fde68a' }} animate={{ scale: 1, color: '#ffffff' }} transition={{ duration: .25 }} className="mt-1 text-right text-[clamp(13px,3.5vw,17px)] font-black tabular-nums tracking-tight drop-shadow-[0_2px_5px_rgba(0,0,0,.8)]">{oil.toFixed(5)}</motion.div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10"><motion.div animate={{ width: `${Math.max(2, Math.min(100, oilRatio * 100))}%` }} transition={{ duration: .5 }} className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-200 shadow-[0_0_8px_rgba(251,191,36,.9)]"/></div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: -18, rotateY: 24, scale: .88 }}
            animate={{ opacity: 1, x: 0, rotateY: 7, scale: 1, y: [0, -3, 0] }}
            transition={{ opacity: { delay: .12, duration: .45 }, x: { delay: .12, duration: .45, type: 'spring', stiffness: 150 }, rotateY: { delay: .12, duration: .5 }, y: { duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: .5 } }}
            className="rounded-xl border border-rose-200/35 bg-gradient-to-br from-[#39243a]/95 via-[#21172d]/95 to-[#100d20]/95 px-2 py-2 shadow-[0_8px_0_rgba(12,5,20,.8),0_12px_24px_rgba(0,0,0,.48),inset_0_1px_0_rgba(255,255,255,.22)] backdrop-blur-md"
            style={{ transformStyle: 'preserve-3d' }}
          >
            <div className="flex items-center gap-1 text-[9px] font-black leading-tight text-slate-300"><Gauge className="h-3 w-3 shrink-0 text-rose-400 drop-shadow-[0_0_5px_rgba(251,113,133,.8)]"/> <span>{t(lang,'oilPerTap')}</span></div>
            <div className="mt-1 text-right text-[clamp(13px,3.5vw,17px)] font-black tabular-nums tracking-tight text-white drop-shadow-[0_2px_5px_rgba(0,0,0,.8)]">{perTap.toLocaleString()}</div>
            <div className="mt-1 text-right text-[8px] font-bold text-rose-200/65">{lang === 'ar' ? 'لكل ضغطة' : 'PER TAP'}</div>
          </motion.div>
        </div>
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: [0, -2, 0] }}
          transition={{ opacity: { duration: .4 }, y: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' } }}
          className="pointer-events-none absolute right-3 top-3 z-20 rounded-full border border-white/20 bg-black/40 px-2.5 py-1 text-[9px] font-black text-white/85 shadow-lg backdrop-blur-md"
        >
          <span className={active ? 'mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'mr-1 inline-block h-1.5 w-1.5 rounded-full bg-rose-400'}/>
          {active ? (lang === 'ar' ? 'المضخة تعمل' : 'PUMP LIVE') : (lang === 'ar' ? 'المضخة متوقفة' : 'PUMP IDLE')}
        </motion.div>
        {shortsVisible&&<motion.button type="button" onClick={event=>{event.stopPropagation();haptic('medium');onOpenShorts();}} initial={{scale:.8,opacity:0}} animate={{scale:[1,1.08,1],opacity:1,rotate:[0,-3,3,0]}} transition={{scale:{duration:1,repeat:Infinity},rotate:{duration:1,repeat:Infinity},opacity:{duration:.2}}} whileTap={{scale:.92}} className="absolute left-[2.5%] top-[25%] z-30 h-14 w-14 overflow-hidden rounded-2xl border-2 border-red-400 bg-black shadow-[0_0_20px_rgba(239,68,68,.65)]" aria-label={t(lang,'shortsTitle')}><img src="/images/shop/live.png" alt="" className="h-full w-full object-contain"/></motion.button>}
        <AnimatePresence>{floats.map(f=><motion.div key={f.id} initial={{opacity:1,y:0,scale:.8}} animate={{opacity:0,y:-80,scale:1.4}} exit={{opacity:0}} transition={{duration:1}} className="pointer-events-none absolute left-1/2 top-1/2 z-30 -translate-x-1/2 text-xl font-black text-amber-300 drop-shadow-lg">+{f.v}</motion.div>)}</AnimatePresence>

      </div>

      <div className="mx-auto grid w-full max-w-md grid-cols-2 gap-2 px-3 pb-2 pt-3">
        <Button onClick={active?undefined:oil>0?handleSell:handleTap} disabled={active} className={`game-cta h-14 rounded-2xl border border-orange-100/50 font-black text-sm shadow-[0_6px_0_#a95620,0_12px_24px_rgba(240,138,48,.25),inset_0_1px_0_rgba(255,255,255,.5)] transition-all ${active?'cursor-not-allowed bg-gradient-to-b from-[#b98a5c] to-[#936b49] text-white/80 opacity-80':'bg-gradient-to-b from-[#ffc36b] via-[#ff9d3d] to-[#ed7928] text-white'}`}>
          {active?<Clock className="mr-1.5 h-5 w-5 animate-pulse"/>:oil>0?<Droplet className="mr-1.5 h-5 w-5"/>:<Power className="mr-1.5 h-5 w-5"/>}
          {active?`${t(lang,'sellLocked')} · ${formatHHMMSS(secRem)}`:oil>0?t(lang,'sell'):t(lang,'startMining')}
        </Button>
        <Button onClick={()=>{haptic('light');onGoToStore();}} className="h-14 rounded-2xl border border-cyan-100/50 bg-gradient-to-b from-[#4ce0df] via-[#25c6c8] to-[#109aa8] text-base font-black text-white shadow-[0_6px_0_#087f88,0_12px_24px_rgba(16,185,190,.22),inset_0_1px_0_rgba(255,255,255,.5)]">
          <ArrowUpRight className="mr-1.5 h-5 w-5"/>{t(lang,'upgrade')}
        </Button>
      </div>


      <div className="mx-auto -mt-1 w-full max-w-md px-3">
        <div className="flex items-center justify-between rounded-xl border border-emerald-300/40 bg-gradient-to-b from-emerald-400 to-emerald-600 px-4 py-2 text-white shadow-[0_4px_0_#087b50,0_8px_18px_rgba(0,0,0,.25)]">
          <div className="flex items-center gap-2 text-xs font-black"><Clock className="h-4 w-4"/>{active?(lang==='ar'?'المضخة تعمل':'PUMP RUNNING'):(lang==='ar'?'الوقت المتبقي':'TIME LEFT')}</div>
          <div className="text-lg font-black tabular-nums">{formatHHMMSS(secRem)}</div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><motion.div animate={{width:`${cycleProgress*100}%`}} transition={{duration:.3}} className="h-full rounded-full bg-emerald-200"/></div>
        <div className="mt-1 flex items-center justify-between px-1 text-[10px] font-bold text-white/55"><span>{t(lang,'usingSpeed')}</span><span>{coinsPerHour.toLocaleString()} {t(lang,'coinsPerHour')}</span></div>
      </div>

      <div className="mx-auto mt-1 w-full max-w-md px-3 pb-2">
        <HybridRewardedAd initData={initData} isVerified={isVerified} title={t(lang,'tadsWatchAdReward')} actionLabel={t(lang,'tadsWatchAdReward')} loadingLabel={t(lang,'tadsRewardLoading')} onRewarded={handleAdRewarded} onError={handleAdRewardError}/>
      </div>
      <SellModal open={sellOpen} onClose={()=>setSellOpen(false)} initData={initData} isVerified={isVerified}/>
      {feeGateOpen&&<MiningFeeGate initData={initData} onActivated={handleFeeActivated} onClose={()=>setFeeGateOpen(false)}/>}
    </div>
  );
}


function formatHHMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
