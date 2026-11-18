'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Gift, X, Sparkles, Loader2 } from 'lucide-react';
import { useGame } from '@/lib/store';
import { t } from '@/lib/i18n';
import { useTelegram } from '@/hooks/use-telegram';
import { HybridRewardedAd } from '@/components/aram/HybridRewardedAd';

type WheelState = { freeAvailable: boolean; freeNextAt: number | null; adViews: number; adsNeeded: number; extraSpinAvailable: boolean; prizes: number[] };
type SpinResult = { prize: number; prizeIndex: number; spinType: 'free' | 'ads'; balance: number };
const VALUES = [10, 5, 15, 25, 35, 45, 7, 20];
const COLORS = ['#f04438','#2997e8','#45b44d','#ff9800','#9c27b0','#08b8cb','#e91e63','#ffe33b'];

export function LuckyWheel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lang = useGame((s) => s.lang);
  const syncServerWalletCoins = useGame((s) => s.syncServerWalletCoins);
  const { initData, isVerified, haptic, notify } = useTelegram();
  const [state, setState] = useState<WheelState | null>(null);
  const [loading, setLoading] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const [celebrate, setCelebrate] = useState(false);

  const loadState = useCallback(async () => {
    if (!initData || !isVerified) return;
    const response = await fetch('/api/lucky-wheel', { headers: { 'X-Telegram-Init-Data': initData }, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'lucky_wheel_unavailable');
    setState(data as WheelState);
  }, [initData, isVerified]);

  useEffect(() => {
    if (!open) return;
    setResult(null); setMessage('');
    void loadState().catch(() => setMessage(t(lang, 'luckyWheelError')));
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, loadState, lang]);

  const countdown = useMemo(() => {
    const left = Math.max(0, (state?.freeNextAt ?? 0) - now);
    const hours = Math.floor(left / 3600000);
    const minutes = Math.floor((left % 3600000) / 60000);
    const seconds = Math.floor((left % 60000) / 1000);
    return [hours, minutes, seconds].map((v) => String(v).padStart(2, '0')).join(':');
  }, [state?.freeNextAt, now]);

  const spin = async () => {
    if (!state || spinning || loading || (!state.freeAvailable && !state.extraSpinAvailable)) return;
    setLoading(true); setMessage(''); setResult(null); haptic('medium');
    try {
      const response = await fetch('/api/lucky-wheel', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData }, body: JSON.stringify({ action: 'spin' }), cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || data.ok !== true) throw new Error(data.error || 'spin_failed');
      const prizeResult: SpinResult = { prize: Number(data.prize), prizeIndex: Number(data.prizeIndex), spinType: data.spinType, balance: Number(data.balance) };
      setResult(prizeResult);
      syncServerWalletCoins(prizeResult.balance);
      setState((current) => current ? { ...current, ...(data.state || {}), freeAvailable: Boolean(data.state?.freeAvailable), freeNextAt: data.state?.freeNextAt ?? current.freeNextAt, adViews: Number(data.state?.adViews ?? 0), adsNeeded: Number(data.state?.adsNeeded ?? 3), extraSpinAvailable: false } : current);
      setRotation((current) => current + 360 * 7 + ((360 - ((current % 360 + prizeResult.prizeIndex * 45) % 360)) % 360));
      setSpinning(true);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setMessage(code === 'spin_not_ready' ? t(lang, 'luckyWheelWaitFree') : t(lang, 'luckyWheelError'));
      await loadState().catch(() => undefined);
    } finally { setLoading(false); }
  };

  const onAdRewarded = useCallback(() => {
    haptic('light');
    setMessage(t(lang, 'luckyWheelAdDone'));
    void loadState().catch(() => undefined);
  }, [haptic, loadState, lang]);
  const onAdError = useCallback(() => {
    setMessage(t(lang, 'luckyWheelTryLater'));
    void loadState().catch(() => undefined);
  }, [loadState, lang]);

  const onSpinEnd = () => {
    if (!spinning) return;
    setSpinning(false); setCelebrate(true); notify('success');
    window.setTimeout(() => setCelebrate(false), 2100);
    void loadState().catch(() => undefined);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ opacity: 0, y: 28, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: .96 }} className="relative max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-[28px] border border-amber-300/50 bg-gradient-to-b from-[#fff1ce] via-[#ffe2b3] to-[#f6bd7c] p-4 text-[#321b08] shadow-2xl">
            <button type="button" onClick={onClose} className="absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full bg-[#6a3a18]/10"><X className="h-5 w-5" /></button>
            <div className="mb-3 flex items-center justify-center gap-2 pt-1"><Gift className="h-6 w-6 text-orange-600" /><h2 className="text-center text-lg font-black">{t(lang, 'luckyWheelHeader')}</h2></div>
            <div className="relative mx-auto my-3 aspect-square w-full max-w-[330px]">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-300 via-yellow-500 to-orange-600 p-[9px] shadow-[0_12px_30px_rgba(115,55,8,.3)]">
                <div className="relative h-full w-full rounded-full border-[5px] border-amber-100 shadow-inner" style={{ background: `conic-gradient(from -22.5deg, ${COLORS.map((c,i)=>`${c} ${i*45}deg ${(i+1)*45}deg`).join(',')})`, transform: `rotate(${rotation}deg)`, transition: spinning ? 'transform 10s cubic-bezier(.12,.78,.08,1)' : 'none' }} onTransitionEnd={onSpinEnd}>
                  {VALUES.map((value, index) => <div key={value} className="absolute left-1/2 top-1/2 flex h-[46%] w-10 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-start pt-2 text-white drop-shadow-[0_2px_2px_rgba(0,0,0,.65)]" style={{ transform: `translate(-50%,-50%) rotate(${index*45}deg) translateY(-72px)` }}><span className="text-xl font-black">{value}</span><span className="mt-1 text-xl">💰</span></div>)}
                </div>
              </div>
              <div className="absolute -top-1 left-1/2 z-10 -translate-x-1/2 drop-shadow-md"><div className="h-0 w-0 border-x-[19px] border-t-[31px] border-x-transparent border-t-orange-500" /></div>
              <div className="absolute left-1/2 top-1/2 z-10 grid h-[58px] w-[58px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[5px] border-amber-200 bg-gradient-to-br from-white to-amber-100 text-2xl shadow-lg">🪙</div>
            </div>

            <div className="mb-3 rounded-2xl border border-amber-500/25 bg-white/55 p-3 text-center">
              {!state ? <span className="text-xs font-bold">{t(lang, 'luckyWheelLoading')}</span> : state.freeAvailable ? <span className="text-sm font-black text-emerald-700">{t(lang, 'luckyWheelFreeReady')}</span> : <div><div className="text-xs font-bold text-amber-900/70">{t(lang, 'luckyWheelFreeWait')}</div><div className="mt-1 font-mono text-xl font-black text-orange-700">{countdown}</div></div>}
              {!state?.freeAvailable && <div className="mt-2 text-[11px] font-bold text-amber-900/75">{t(lang, 'luckyWheelWatchThree')} · {t(lang, 'luckyWheelAdProgress')}: {state?.adViews ?? 0}/3</div>}
              {state?.extraSpinAvailable && <div className="mt-1 text-xs font-black text-emerald-700">{t(lang, 'luckyWheelExtraReady')}</div>}
            </div>

            <button type="button" disabled={!state || loading || spinning || (!state.freeAvailable && !state.extraSpinAvailable)} onClick={spin} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 px-5 py-3 text-base font-black text-white shadow-[0_7px_0_#a64a0c,0_12px_20px_rgba(110,50,5,.2)] transition active:translate-y-1 active:shadow-[0_3px_0_#a64a0c] disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}{spinning ? t(lang, 'luckyWheelSpinning') : t(lang, 'luckyWheelSpin')}
            </button>

            {!state?.freeAvailable && !state?.extraSpinAvailable && (
              <div className="mt-3 rounded-2xl border border-amber-600/20 bg-white/45 p-3">
                <HybridRewardedAd initData={initData} isVerified={isVerified} title={t(lang, 'luckyWheelWatchThree')} actionLabel={t(lang, 'luckyWheelWatchThree')} loadingLabel={t(lang, 'luckyWheelLoading')} rewardPurpose="lucky_wheel" onRewarded={onAdRewarded} onError={onAdError} />
                <div className="mt-1 text-center text-[10px] font-bold text-amber-900/65">{t(lang, 'luckyWheelAdProgress')}: {state?.adViews ?? 0}/3</div>
              </div>
            )}
            {message && <p className="mt-3 rounded-xl bg-white/60 px-3 py-2 text-center text-xs font-bold text-amber-950">{message}</p>}
            {result && !spinning && <div className="mt-3 rounded-2xl border border-emerald-400/50 bg-emerald-50/90 p-3 text-center"><div className="text-sm font-black text-emerald-800">{t(lang, 'luckyWheelWin')}</div><div className="mt-1 text-3xl font-black text-emerald-700">+{result.prize} {t(lang, 'luckyWheelCoins')} 🎉</div></div>}

            {celebrate && <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-[28px]">{Array.from({length:28},(_,i)=><span key={i} className="absolute top-1/2 h-2 w-2 rounded-sm" style={{left:`${(i*37)%100}%`,background:COLORS[i%COLORS.length],animation:`lucky-confetti 1.9s ease-out ${(i%7)*.035}s forwards`,transform:`rotate(${i*41}deg)`}} />)}</div>}
            <button type="button" onClick={onClose} className="mt-3 w-full py-2 text-xs font-black text-amber-900/65">{t(lang, 'luckyWheelClose')}</button>
          </motion.div>
          <style jsx global>{`@keyframes lucky-confetti{0%{opacity:0;translate:0 0;scale:.4}15%{opacity:1}100%{opacity:0;translate:${'var(--confetti-x, 0px)'} 220px;scale:1.2}}`}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
