'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PumpScene } from '../PumpScene';
import { SellModal } from '../SellModal';
import { Button } from '@/components/ui/button';
import { Coins, Droplet, Gauge, ArrowUpRight, Clock, Zap, Power, Package, Dices, Sparkles } from 'lucide-react';
import {
  useGame,
  effectiveCapacity,
  effectiveOilPerTap,
  effectiveCoinsPerHour,
  isCycleActive,
  cycleSecondsRemaining,
  CYCLE_SECONDS,
  litersToBarrels,
  litersToCoins,
  LITERS_PER_BARREL,
} from '@/lib/store';
import { t } from '@/lib/i18n';
import { useTelegram } from '@/hooks/use-telegram';
import { HybridRewardedAd } from '@/components/aram/HybridRewardedAd';
import { toast } from 'sonner';
import { MiningFeeGate } from '@/components/aram/MiningFeeGate';

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
  const [feeGateOpen, setFeeGateOpen] = useState(false);
  const coins = useGame((s) => s.coins);
  const upgrades = useGame((s) => s.upgrades);
  const baseOilPerTap = useGame((s) => s.baseOilPerTap);
  const baseCapacity = useGame((s) => s.baseCapacity);
  const parts = useGame((s) => s.parts);
  const specialParts = useGame((s) => s.specialParts);
  const cycleEndsAt = useGame((s) => s.cycleEndsAt);
  const applyServerAdReward = useGame((s) => s.applyServerAdReward);
  const { haptic, notify } = useTelegram();

  const [sellOpen, setSellOpen] = useState(false);
  const [shortsVisible, setShortsVisible] = useState(false);
  const [floats, setFloats] = useState<{ id: number; v: number }[]>([]);
  const fidRef = useRef(0);

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
    const data = await response.json() as { ok?: boolean; error?: string; oil?: number; coins?: number; cycleEndsAt?: number | null; oilAdded?: number };
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
  const perTap = Math.floor(effectiveOilPerTap(upgrades, Date.now(), baseOilPerTap) * (specialParts.new_background ? 5 : 1) * (specialParts.vip_badge ? 4 : 1));
  const coinsPerHour = effectiveCoinsPerHour(upgrades);
  const oilRatio = oil / cap;
  const isFull = oil >= cap;

  const now = Date.now();
  const active = feeActivated && isCycleActive(cycleEndsAt, now);
  const secRem = cycleSecondsRemaining(cycleEndsAt, now);
  const cycleProgress = cycleEndsAt ? (active ? 1 - secRem / CYCLE_SECONDS : 1) : 0;

  const handleFeeActivated = useCallback(() => {
    setFeeActivated(true);
    setFeeGateOpen(false);
    void refreshMining('tap').then((result) => {
      if (result.cycleStarted) notify('success');
    }).catch(() => toast.error(t(lang, 'tadsUnavailable')));
  }, [refreshMining, notify, lang]);

  useEffect(() => {
    let active = true;
    fetch('/api/mining/activation', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'activation_status_unavailable');
        if (active) {
          setFeeActivated(data.required !== true);
        }
      })
      .catch(() => { if (active) setFeeActivated(false); });
    return () => { active = false; };
  }, [initData]);

  const handleTap = () => {
    if (!feeActivated) {
      setFeeGateOpen(true);
      return;
    }
    // Once a 12-hour cycle ends, the accumulated oil must be sold before another cycle can start.
    if (!active && oil > 0) return;
    haptic('light');
    void refreshMining('tap').then((r) => {
      if (r.cycleStarted) notify('success');
      if (Number(r.oilAdded ?? 0) > 0) {
        const id = ++fidRef.current;
        setFloats((f) => [...f, { id, v: Number(r.oilAdded) }]);
        setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1000);
      } else if (Number(r.oil ?? 0) >= Number(r.capacity ?? cap)) {
        haptic('heavy');
      }
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'mining_unavailable';
      if (message === 'mining_activation_required') setFeeGateOpen(true);
      else if (message === 'previous_cycle_must_be_sold' || message === 'oil_must_be_sold_before_new_cycle') toast.error(t(lang, 'sell'));
      else toast.error(t(lang, 'tadsUnavailable'));
    });
  };

  const handleSell = () => {
    if (!feeActivated) {
      setFeeGateOpen(true);
      return;
    }
    if (active || oil <= 0) return;
    haptic('medium');
    setSellOpen(true);
  };

  const handleAdRewarded = useCallback((reward: number, walletCoins: number) => {
    applyServerAdReward(reward, walletCoins);
    haptic('medium');
    notify('success');
    toast.success(`${t(lang, 'tadsRewardSuccess')} +${reward} ${t(lang, 'coins')}`);
  }, [applyServerAdReward, haptic, lang, notify]);

  const handleAdRewardError = useCallback((error: string) => {
    if (error === 'reward_cooldown') toast.error(t(lang, 'tadsRewardCooldown'));
    else if (error === 'daily_reward_limit_reached') toast.error(t(lang, 'tadsRewardLimit'));
    else if (error === 'telegram_auth_required') toast.error(t(lang, 'telegramRequired'));
    else if (error === 'no_ad_available' || error === 'ad_timeout') toast.error(t(lang, 'noAdsAvailable'));
    else toast.error(t(lang, 'tadsUnavailable'));
  }, [lang]);

  return (
    <div className="relative flex h-full flex-col overflow-y-auto overscroll-contain pb-3">
      {/* Stats strip */}
      <div className="px-3 pt-2 pb-1 max-w-md mx-auto w-full">
        <div className="grid grid-cols-3 gap-2">
          <StatPill
            icon={<Droplet className="w-3.5 h-3.5 text-amber-400" />}
            label={t(lang, 'oil')}
            value={oil.toFixed(0)}
            sub={`/ ${cap}`}
            progress={oilRatio}
          />
          <StatPill
            icon={<Coins className="w-3.5 h-3.5 text-amber-400" />}
            label={t(lang, 'coins')}
            value={coins.toLocaleString()}
          />
          <StatPill
            icon={<Gauge className="w-3.5 h-3.5 text-purple-300" />}
            label={t(lang, 'oilPerTap')}
            value={`+${perTap}`}
          />
        </div>
      </div>

      {/* Scene */}
      <div className="relative max-w-md mx-auto w-full px-2">
        <PumpScene pumping={active} oilRatio={oilRatio} onTap={handleTap} parts={parts} specialParts={specialParts} />
        {shortsVisible && (
          <motion.button
            type="button"
            onClick={(event) => { event.stopPropagation(); haptic('medium'); onOpenShorts(); }}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: [1, 1.08, 1], opacity: 1, rotate: [0, -3, 3, 0] }}
            transition={{ scale: { duration: 1, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 1, repeat: Infinity, ease: 'easeInOut' }, opacity: { duration: 0.2 } }}
            whileTap={{ scale: 0.92 }}
            className="absolute left-[2.5%] top-[25%] z-30 h-16 w-16 overflow-hidden rounded-2xl border-2 border-red-400 bg-black shadow-[0_0_20px_rgba(239,68,68,.65)]"
            aria-label={t(lang, 'shortsTitle')}
            title={t(lang, 'shortsTitle')}
          >
            <img src="/images/shop/live.png" alt="" className="h-full w-full object-contain" />
          </motion.button>
        )}

        {/* Floating +oil numbers */}
        <AnimatePresence>
          {floats.map((f) => (
            <motion.div
              key={f.id}
              initial={{ opacity: 1, y: 0, scale: 0.8 }}
              animate={{ opacity: 0, y: -80, scale: 1.4 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1 }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 pointer-events-none text-amber-300 font-black text-xl drop-shadow-lg"
            >
              +{f.v}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Pump OFF overlay */}
        {!active && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div className="bg-black/60 backdrop-blur-sm rounded-2xl px-5 py-3 flex items-center gap-2 border border-amber-500/30">
              <Power className="w-5 h-5 text-red-400" />
              <div className="text-center">
                <div className="text-red-300 font-black text-sm">{t(lang, 'pumpOff')}</div>
                <div className="text-amber-200/80 text-[10px] font-bold">{t(lang, 'tapToStart')}</div>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Lucky Arena entry banner */}
      <div className="mx-auto mt-3 w-full max-w-md px-3">
        <motion.button
          type="button"
          onClick={() => { haptic('medium'); onGoToArena(); }}
          whileTap={{ scale: 0.985 }}
          whileHover={{ y: -2 }}
          className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-amber-300/35 bg-gradient-to-r from-[#211a31] via-[#302044] to-[#4b2b28] p-3 text-start shadow-[0_8px_24px_rgba(0,0,0,.28)]"
          aria-label={t(lang, 'arenaPromoTitle')}
        >
          <div className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full bg-amber-400/15 blur-2xl" />
          <div className="relative h-[76px] w-[76px] shrink-0">
            <motion.div
              aria-hidden="true"
              animate={{ rotate: 360 }}
              transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-0 rounded-full border-[5px] border-[#30233d] shadow-[0_0_0_2px_rgba(255,220,150,.35),0_5px_16px_rgba(0,0,0,.4)]"
              style={{ background: 'conic-gradient(from -20deg, #f59e0b 0deg 90deg, #2457f5 90deg 180deg, #8b5cf6 180deg 270deg, #10b981 270deg 360deg)' }}
            >
              <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-amber-200 shadow" />
              <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 shadow" />
            </motion.div>
            <div className="absolute inset-[27%] grid place-items-center rounded-full border-2 border-amber-100/80 bg-[#211a31] text-amber-200 shadow-lg">
              <Dices className="h-5 w-5" />
            </div>
            <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full border border-white/50 bg-gradient-to-br from-amber-300 to-orange-500 text-[#3a2108] shadow-md">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="relative min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[15px] font-black text-white">{t(lang, 'arenaPromoTitle')}</span>
              <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[9px] font-black text-emerald-200">{t(lang, 'arenaPromoBadge')}</span>
            </div>
            <p className="text-[11px] leading-relaxed text-amber-50/75">{t(lang, 'arenaPromoDesc')}</p>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-300 to-orange-400 px-3 py-1.5 text-[11px] font-black text-[#3b220d] shadow">
              {t(lang, 'arenaPromoAction')}
              <span aria-hidden="true" className="text-sm">←</span>
            </div>
          </div>
          <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/5 transition group-hover:ring-amber-200/30" />
        </motion.button>
      </div>

      {/* === Cycle timer + speed display === */}
      <div className="max-w-md mx-auto w-full px-3 mt-1">
        <div className={`aram-card rounded-2xl p-3 ${!active ? 'aram-shake' : ''}`} style={{ animationIterationCount: active ? 0 : 1 }}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Clock className={`w-4 h-4 ${active ? 'text-emerald-600' : 'text-red-500'}`} />
              <span className="text-xs font-black text-[#2a1c0a]">{t(lang, 'pumpCycle')}</span>
              {active ? (
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-black">
                  {t(lang, 'cycleActive')}
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[9px] font-black">
                  {t(lang, 'cycleEnded')}
                </span>
              )}
            </div>
            <div className={`text-base font-black tabular-nums ${active ? 'text-emerald-700' : 'text-red-600'}`}>
              {formatHHMMSS(secRem)}
            </div>
          </div>
          {/* Cycle progress bar */}
          <div className="h-1.5 rounded-full bg-amber-900/15 overflow-hidden mb-2">
            <motion.div
              animate={{ width: `${cycleProgress * 100}%` }}
              transition={{ duration: 0.3 }}
              className={`h-full rounded-full ${cycleEndsAt ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : 'bg-red-400'}`}
            />
          </div>

          {/* Active speed display */}
          <div className="flex items-center justify-between pt-1 border-t border-amber-900/10">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[10px] font-bold text-amber-900/70 uppercase">{t(lang, 'usingSpeed')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-black text-[#2a1c0a] tabular-nums">{coinsPerHour.toLocaleString()}</span>
              <span className="text-[10px] text-amber-900/60 font-bold">{t(lang, 'coinsPerHour')}</span>
            </div>
          </div>
          {/* Breakdown */}
          <div className="flex items-center gap-1.5 mt-1 text-[9px] text-amber-900/60 font-bold">
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
              {t(lang, 'baseRate')}: 60
            </span>
            {upgrades.length > 0 ? (
              <>
                <span>+</span>
                {upgrades.reduce((acc, u, i) => {
                  const pkg = PACKAGES_Find(u.packageId);
                  if (!pkg) return acc;
                  return [...acc, <span key={i} className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                    {pkg.id.toUpperCase()}: +{pkg.perHour}
                  </span>];
                }, [] as React.ReactNode[])}
              </>
            ) : (
              <span className="text-amber-900/40">· {t(lang, 'perCycle12h')}: {(coinsPerHour * 12).toLocaleString()}</span>
            )}
            {upgrades.length > 0 && (
              <span className="text-amber-900/40">· {t(lang, 'perCycle12h')}: {(coinsPerHour * 12).toLocaleString()}</span>
            )}
          </div>
        </div>
      </div>

      {/* === Oil ready / barrel conversion info === */}
      <div className="max-w-md mx-auto w-full px-3 mt-1">
        <motion.div
          key={oil > 0 ? 'has-oil' : 'no-oil'}
          initial={{ scale: oil > 0 ? 0.97 : 1, opacity: 0.7 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`aram-card rounded-2xl p-3 ${
            oil > 0 ? 'border-amber-400/60' : ''
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Package className="w-4 h-4 text-amber-700" />
              <span className="text-xs font-black text-[#2a1c0a]">{t(lang, 'oilReady')}</span>
            </div>
            <div className="text-[10px] text-amber-900/60 font-bold px-2 py-0.5 rounded-full bg-amber-100">
              {t(lang, 'barrelRate')}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-lg bg-amber-50 py-1.5 text-center">
              <div className="text-[9px] text-amber-900/60 font-bold uppercase">{t(lang, 'liters')}</div>
              <div className="text-sm font-black text-[#2a1c0a] tabular-nums">{oil.toFixed(0)}</div>
            </div>
            <div className="rounded-lg bg-amber-50 py-1.5 text-center">
              <div className="text-[9px] text-amber-900/60 font-bold uppercase">{t(lang, 'barrels')}</div>
              <div className="text-sm font-black text-amber-700 tabular-nums">{litersToBarrels(oil)}</div>
            </div>
            <div className="rounded-lg bg-emerald-50 py-1.5 text-center">
              <div className="text-[9px] text-emerald-900/60 font-bold uppercase">{t(lang, 'worth')}</div>
              <div className="text-sm font-black text-emerald-700 tabular-nums">{litersToCoins(oil).toLocaleString()}</div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Storage full warning */}
      {isFull && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md mx-auto w-full px-3 mt-1"
        >
          <div className="aram-shake px-3 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-xs font-bold text-center">
            ⚠ {t(lang, 'storageFull')} — {t(lang, 'sell')}!
          </div>
        </motion.div>
      )}

      {/* Action buttons */}
      <div className="max-w-md mx-auto w-full px-3 mt-2 pb-4 grid grid-cols-2 gap-2">
        <Button
          onClick={active ? undefined : oil > 0 ? handleSell : handleTap}
          disabled={active}
          className={`h-14 rounded-2xl font-black text-sm sm:text-base shadow-lg transition-all ${active
            ? 'bg-gradient-to-r from-slate-500 to-slate-600 text-white/90 opacity-80 cursor-not-allowed'
            : oil > 0
              ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white'
              : 'bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-[#2a1c0a]'}`}
        >
          {active ? <Clock className="w-5 h-5 mr-1.5 animate-pulse" /> : oil > 0 ? <Droplet className="w-5 h-5 mr-1.5" /> : <Power className="w-5 h-5 mr-1.5" />}
          {active
            ? `${t(lang, 'sellLocked')} · ${formatHHMMSS(secRem)}`
            : oil > 0
              ? t(lang, 'sell')
              : t(lang, 'startMining')}
        </Button>
        <Button
          onClick={() => { haptic('light'); onGoToStore(); }}
          className="h-14 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-[#2a1c0a] font-black text-base shadow-lg"
        >
          <ArrowUpRight className="w-5 h-5 mr-1.5" />
          {t(lang, 'upgrade')}
        </Button>
      </div>

      <div className="mx-auto mt-1 w-full max-w-md px-3 pb-2">
        <HybridRewardedAd
          initData={initData}
          isVerified={isVerified}
          title={t(lang, 'tadsWatchAdReward')}
          actionLabel={t(lang, 'tadsWatchAdReward')}
          loadingLabel={t(lang, 'tadsRewardLoading')}
          onRewarded={handleAdRewarded}
          onError={handleAdRewardError}
        />      </div>

      <SellModal open={sellOpen} onClose={() => setSellOpen(false)} initData={initData} isVerified={isVerified} />
      {feeGateOpen && <MiningFeeGate initData={initData} onActivated={handleFeeActivated} onClose={() => setFeeGateOpen(false)} />}
    </div>
  );
}

// Local helper to find a package by id without importing the whole wallets module.
import { PACKAGES } from '@/lib/wallets';
function PACKAGES_Find(id: string) {
  return PACKAGES.find((p) => p.id === id);
}

function StatPill({
  icon,
  label,
  value,
  sub,
  progress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  progress?: number;
}) {
  return (
    <div className="aram-card rounded-xl px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] text-amber-900/70 font-bold mb-0.5">
        {icon}
        <span className="uppercase">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-sm font-black text-[#2a1c0a] tabular-nums">{value}</span>
        {sub && <span className="text-[10px] text-amber-900/60 font-bold">{sub}</span>}
      </div>
      {progress !== undefined && (
        <div className="mt-1 h-1 rounded-full bg-amber-900/15 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-300"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
      )}
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
