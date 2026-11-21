'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PumpScene3D, type PumpScene3DHandle } from '../PumpScene3D';
import { Button } from '@/components/ui/button';
import { Droplet, Gauge, ArrowUpRight, Clock, Power } from 'lucide-react';
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
  const soundEnabled = useGame((s) => s.sound);
  const audioRef = useRef<{ pump: HTMLAudioElement; cricket: HTMLAudioElement; carcome: HTMLAudioElement; carout: HTMLAudioElement } | null>(null);
  const [isNight, setIsNight] = useState(() => {
    const hour = new Date().getHours();
    return hour < 6 || hour >= 18;
  });
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
  const applyServerSale = useGame((s) => s.applyServerSale);
  const { haptic, notify } = useTelegram();

  const [shortsVisible, setShortsVisible] = useState(false);
  const [floats, setFloats] = useState<{ id: number; v: number }[]>([]);

  // Ambient and truck sounds are owned by the pump screen so they follow the
  // persisted sound preference and the real server-confirmed mining state.
  useEffect(() => {
    const audio = {
      pump: new Audio('/audio/pump.MP3'),
      cricket: new Audio('/audio/cricket.mp3'),
      carcome: new Audio('/audio/carcome.MP3'),
      carout: new Audio('/audio/carout.MP3'),
    };
    audio.pump.loop = true;
    audio.cricket.loop = true;
    audio.pump.volume = 0.38;
    audio.cricket.volume = 0.32;
    audio.carcome.volume = 0.75;
    audio.carout.volume = 0.75;
    Object.values(audio).forEach((item) => { item.preload = 'auto'; });
    audioRef.current = audio;
    return () => {
      Object.values(audio).forEach((item) => { item.pause(); item.currentTime = 0; });
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const updateNight = () => {
      const hour = new Date().getHours();
      setIsNight(hour < 6 || hour >= 18);
    };
    updateNight();
    const id = window.setInterval(updateNight, 60_000);
    return () => window.clearInterval(id);
  }, []);
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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const syncAmbient = () => {
      if (!soundEnabled) {
        audio.pump.pause();
        audio.cricket.pause();
        return;
      }
      const syncLoop = (item: HTMLAudioElement, shouldPlay: boolean) => {
        if (shouldPlay) {
          if (item.paused) void item.play().catch(() => undefined);
        } else {
          item.pause();
        }
      };
      syncLoop(audio.pump, active);
      syncLoop(audio.cricket, isNight);
    };
    syncAmbient();
    // Mobile browsers may block autoplay until the first real user gesture.
    window.addEventListener('pointerdown', syncAmbient);
    return () => window.removeEventListener('pointerdown', syncAmbient);
  }, [soundEnabled, active, isNight]);

  const handleSellPhase = useCallback((phase: string) => {
    if (!soundEnabled) return;
    const audio = audioRef.current;
    if (!audio) return;
    const playOnce = (item: HTMLAudioElement) => {
      item.pause();
      item.currentTime = 0;
      void item.play().catch(() => undefined);
    };
    if (phase === 'arriving') playOnce(audio.carcome);
    if (phase === 'departing') playOnce(audio.carout);
  }, [soundEnabled]);

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
    if (!isVerified || !initData) {
      toast.error(t(lang, 'sellError'));
      return;
    }
    actionAdBusyRef.current = true;
    // Kick off the in-scene truck sequence first so the player sees the truck
    // driving in while the (optional) ad pre-roll + server call happen in
    // parallel. The scene will not start transferring oil until setSaleResult()
    // pushes the real numbers back from the server.
    sceneRef.current?.triggerSell();
    haptic('medium');
    void rewardActionAd('sell_action')
      .catch((error) => console.info('monetag_sell_ad_unavailable', error))
      .finally(() => {
        void runSell();
      });
  };

  const runSell = async () => {
    try {
      if (!isVerified || !initData) throw new Error('telegram_auth_required');
      // Reuse one idempotency key on retry: if the server committed the sale
      // but the response was interrupted, the retry returns the already-
      // committed wallet instead of attempting another sale.
      const idempotencyKey = crypto.randomUUID();
      let response: Response | null = null;
      type SaleResponse = { sold?: number; coinsEarned?: number; wallet?: { oil: number; coins: number }; error?: string };
      let data: SaleResponse | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await fetch('/api/sell', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
            body: JSON.stringify({ idempotencyKey }),
            cache: 'no-store',
            signal: AbortSignal.timeout(15000),
          });
          data = await response.json() as SaleResponse;
          if (response.ok) break;
          if (response.status < 500 || attempt === 1) throw new Error(data?.error || 'oil_sale_failed');
        } catch (error) {
          lastError = error;
          if (attempt === 1) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      if (!response?.ok || !data?.wallet || !Number.isSafeInteger(data.sold) || !Number.isSafeInteger(data.coinsEarned)) {
        throw lastError instanceof Error ? lastError : new Error(data?.error || 'oil_sale_failed');
      }
      const sale = { sold: Number(data.sold), coinsEarned: Number(data.coinsEarned) };
      applyServerSale(sale.sold, sale.coinsEarned, data.wallet.oil, data.wallet.coins);
      // Hand the real numbers to the 3D scene so its transfer animation
      // counts toward the actual litres sold + coins earned.
      sceneRef.current?.setSaleResult(sale.sold, sale.coinsEarned);
      notify('success');
    } catch (error) {
      console.error('oil_sale_ui_failed', error);
      // Reconcile against Turso after any ambiguous failure. The sale may
      // have committed even if the browser lost its response.
      try {
        const syncResponse = await fetch('/api/game/state', {
          headers: { 'X-Telegram-Init-Data': initData },
          cache: 'no-store',
        });
        if (syncResponse.ok) {
          const syncData = await syncResponse.json() as { wallet?: { oil?: number; coins?: number } | null };
          if (Number.isSafeInteger(syncData.wallet?.oil) && Number.isSafeInteger(syncData.wallet?.coins)) {
            useGame.setState({ oil: Number(syncData.wallet?.oil), coins: Number(syncData.wallet?.coins) });
          }
        }
      } catch (syncError) {
        console.warn('oil_sale_wallet_reconcile_failed', syncError);
      }
      const saleError = error instanceof Error ? error.message : 'oil_sale_failed';
      if (saleError === 'daily_coin_limit_reached') {
        toast.error(lang === 'ar'
          ? 'وصلت إلى الحد اليومي للعملات؛ حاول بيع المتبقي غدًا.'
          : lang === 'ru'
            ? 'Достигнут дневной лимит монет. Попробуйте продать остаток завтра.'
            : 'Daily coin limit reached. Try selling the remaining oil tomorrow.');
      } else {
        toast.error(t(lang, 'sellError'));
      }
      // Abort the in-scene sequence on a hard failure so the truck doesn't
      // hang mid-transfer with no real numbers to count toward.
      sceneRef.current?.resetSell();
    } finally {
      actionAdBusyRef.current = false;
    }
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
    <div className="relative h-full w-full overflow-hidden bg-[#0e1018] text-white">
      {/* Full-screen 3D scene — fills the whole area between TopBar and BottomNav.
          The sell sequence now plays entirely inside this 3D scene: truck
          drives in, work-lights ramp up, hose connects, oil visibly flows,
          lights dim during transfer and ramp back up at departure, truck
          drives off and disappears. The in-scene HUD (phase, oil collected,
          coins earned, progress bar) is rendered by PumpScene3D itself. */}
      <div className="absolute inset-0">
        <PumpScene3D ref={sceneRef} pumping={active} oilRatio={oilRatio} onTap={handleTap} parts={parts} specialParts={specialParts} lang={lang} onSellPhase={handleSellPhase}/>
      </div>

      {/* legibility gradients so floating HUD reads over any sky */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-black/55 to-transparent"/>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-32 bg-gradient-to-t from-black/65 to-transparent"/>

      {/* oil card — top-left, compact, tap-through */}
      <motion.div
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: .4 }}
        className="pointer-events-none absolute left-2.5 top-2.5 z-20 w-[38%] max-w-[160px] rounded-xl border border-cyan-200/30 bg-black/45 px-2 py-1.5 backdrop-blur-md"
      >
        <div className="flex items-center gap-1 text-[9px] font-black leading-tight text-slate-200"><Droplet className="h-3 w-3 shrink-0 text-amber-300"/> <span>{t(lang,'oil')}</span></div>
        <motion.div key={oil.toFixed(5)} initial={{ scale: 1.12, color: '#fde68a' }} animate={{ scale: 1, color: '#ffffff' }} transition={{ duration: .25 }} className="mt-0.5 text-right text-[clamp(13px,3.6vw,17px)] font-black tabular-nums tracking-tight drop-shadow-[0_2px_5px_rgba(0,0,0,.8)]">{oil.toFixed(5)}</motion.div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/15"><motion.div animate={{ width: `${Math.max(2, Math.min(100, oilRatio * 100))}%` }} transition={{ duration: .5 }} className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-200 shadow-[0_0_8px_rgba(251,191,36,.9)]"/></div>
        <div className="mt-1 flex items-center justify-between text-[8px] font-bold text-rose-200/75"><span className="flex items-center gap-0.5"><Gauge className="h-2.5 w-2.5"/>{t(lang,'oilPerTap')}</span><span className="tabular-nums text-white">{perTap.toLocaleString()}</span></div>
        {specialParts.vip_badge && <div className="mt-1 w-fit rounded border border-amber-300/60 bg-amber-500/20 px-1 text-[8px] font-black text-amber-200">👑 VIP</div>}
      </motion.div>

      {/* coins + arena — top-right, compact */}
      <div className="absolute right-2.5 top-2.5 z-20 flex items-center gap-1.5">
        <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .4 }} className="flex items-center gap-1 rounded-lg border border-amber-300/35 bg-black/45 px-2 py-1 backdrop-blur-md">
          <span className="text-[11px]">💰</span>
          <span dir="ltr" className="text-[12px] font-black tabular-nums text-amber-200">{coins.toLocaleString()}</span>
        </motion.div>
        <button type="button" onClick={()=>{haptic('medium');onGoToArena();}} aria-label={t(lang,'arenaPromoTitle')} className="grid h-8 w-8 place-items-center rounded-lg border border-amber-300/30 bg-black/45 text-base backdrop-blur-md">🏆</button>
      </div>

      {/* status pill — under coins */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: [0, -2, 0] }}
        transition={{ opacity: { duration: .4 }, y: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' } }}
        className="pointer-events-none absolute right-2.5 top-12 z-20 rounded-full border border-white/20 bg-black/45 px-2 py-0.5 text-[9px] font-black text-white/85 backdrop-blur-md"
      >
        <span className={active ? 'mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'mr-1 inline-block h-1.5 w-1.5 rounded-full bg-rose-400'}/>
        {active ? (lang === 'ar' ? 'تعمل' : 'LIVE') : (lang === 'ar' ? 'متوقفة' : 'IDLE')}
      </motion.div>

      {/* shorts button */}
      {shortsVisible&&<motion.button type="button" onClick={event=>{event.stopPropagation();haptic('medium');onOpenShorts();}} initial={{scale:.8,opacity:0}} animate={{scale:[1,1.08,1],opacity:1}} transition={{scale:{duration:1,repeat:Infinity},opacity:{duration:.2}}} whileTap={{scale:.92}} className="absolute left-2.5 top-[40%] z-30 h-11 w-11 overflow-hidden rounded-xl border-2 border-red-400 bg-black shadow-[0_0_18px_rgba(239,68,68,.6)]" aria-label={t(lang,'shortsTitle')}><img src="/images/shop/live.png" alt="" className="h-full w-full object-contain"/></motion.button>}

      {/* tap reward floats */}
      <AnimatePresence>{floats.map(f=><motion.div key={f.id} initial={{opacity:1,y:0,scale:.8}} animate={{opacity:0,y:-80,scale:1.4}} exit={{opacity:0}} transition={{duration:1}} className="pointer-events-none absolute left-1/2 top-1/2 z-30 -translate-x-1/2 text-xl font-black text-amber-300 drop-shadow-lg">+{f.v}</motion.div>)}</AnimatePresence>

      {/* bottom floating control cluster — compact, tap-through except controls */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-2.5 pb-2">
        <div className="mx-auto flex max-w-md flex-col gap-1.5">
          <div className="pointer-events-auto flex items-center justify-between gap-2 rounded-xl border border-emerald-300/45 bg-gradient-to-b from-emerald-500/90 to-emerald-700/90 px-3 py-1.5 text-white shadow-[0_4px_0_#087b50,0_8px_18px_rgba(0,0,0,.3)] backdrop-blur-md">
            <div className="flex items-center gap-1.5 text-[11px] font-black"><Clock className="h-3.5 w-3.5"/>{active?(lang==='ar'?'تعمل':'RUNNING'):(lang==='ar'?'المتبقي':'LEFT')}</div>
            <div className="text-base font-black tabular-nums">{formatHHMMSS(secRem)}</div>
            <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-50/90"><Gauge className="h-3 w-3"/>{coinsPerHour.toLocaleString()}</div>
          </div>
          <div className="pointer-events-auto h-1.5 overflow-hidden rounded-full bg-white/15"><motion.div animate={{width:`${cycleProgress*100}%`}} transition={{duration:.3}} className="h-full rounded-full bg-emerald-200"/></div>
          <div className="pointer-events-auto grid grid-cols-2 gap-2">
            <Button onClick={active?undefined:oil>0?handleSell:handleTap} disabled={active} className={`h-11 rounded-xl border text-[13px] font-black shadow-[0_4px_0_rgba(0,0,0,.25),inset_0_1px_0_rgba(255,255,255,.4)] ${active?'cursor-not-allowed border-white/10 bg-gradient-to-b from-[#b98a5c] to-[#936b49] text-white/80 opacity-80':'border-orange-100/50 bg-gradient-to-b from-[#ffc36b] via-[#ff9d3d] to-[#ed7928] text-white'}`}>
              {active?<Clock className="mr-1 h-4 w-4 animate-pulse"/>:oil>0?<Droplet className="mr-1 h-4 w-4"/>:<Power className="mr-1 h-4 w-4"/>}
              {active?t(lang,'sellLocked'):oil>0?t(lang,'sell'):t(lang,'startMining')}
            </Button>
            <Button onClick={()=>{haptic('light');onGoToStore();}} className="flex h-11 items-center justify-center rounded-xl border border-cyan-100/50 bg-gradient-to-b from-[#4ce0df] via-[#25c6c8] to-[#109aa8] text-[13px] font-black text-white shadow-[0_4px_0_#087f88,inset_0_1px_0_rgba(255,255,255,.4)]">
              <ArrowUpRight className="mr-1 h-4 w-4"/>{t(lang,'upgrade')}
            </Button>
          </div>
          <div className="pointer-events-auto"><HybridRewardedAd initData={initData} isVerified={isVerified} title={t(lang,'tadsWatchAdReward')} actionLabel={t(lang,'tadsWatchAdReward')} loadingLabel={t(lang,'tadsRewardLoading')} onRewarded={handleAdRewarded} onError={handleAdRewardError}/></div>
        </div>
      </div>

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
