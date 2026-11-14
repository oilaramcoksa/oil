'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TadsWidget, renderTadsWidget } from 'react-tads-widget';
import { Loader2, Play, ShieldCheck } from 'lucide-react';

const ADEXIUM_WID = 'fac3402b-57c4-45be-9d1d-5589a334852d';
const TADS_WID = 13283;
const REWARD = 100;

type Provider = 'adexium' | 'tads';
type AdexiumAd = { id?: string };
type AdexiumInstance = {
  requestRewardedAd: (format: 'interstitial') => void;
  displayAd: (ad: AdexiumAd) => void;
  on: (event: string, callback: (ad?: AdexiumAd) => void) => void;
  off?: (event: string, callback: (ad?: AdexiumAd) => void) => void;
  destroy?: () => void;
};
declare global {
  interface Window {
    AdexiumWidget?: new (options: { wid: string; adFormat: 'interstitial'; debug?: boolean }) => AdexiumInstance;
  }
}

type Props = {
  initData: string;
  isVerified: boolean;
  title: string;
  actionLabel: string;
  loadingLabel: string;
  onRewarded: (reward: number, walletCoins: number) => void;
  onError: (error: string) => void;
};

export function HybridRewardedAd({ initData, isVerified, title, actionLabel, loadingLabel, onRewarded, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [nextProvider, setNextProvider] = useState<Provider>('adexium');
  const [cycle, setCycle] = useState<{ used: number; remaining: number; cooldownUntil: number | null } | null>(null);
  const [now, setNow] = useState(Date.now());
  const instanceRef = useRef<AdexiumInstance | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const completedRef = useRef(false);
  const fallbackRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const providerRef = useRef<Provider>('adexium');
  const busyRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const loadCycle = useCallback(async () => {
    if (!isVerified || !initData) return;
    const response = await fetch('/api/ads/reward', { headers: { 'X-Telegram-Init-Data': initData }, cache: 'no-store' });
    if (!response.ok) throw new Error('ad_progress_unavailable');
    const data = await response.json() as { used?: number; remaining?: number; cooldownUntil?: number | null; nextProvider?: Provider };
    setCycle({ used: Number(data.used ?? 0), remaining: Number(data.remaining ?? 30), cooldownUntil: data.cooldownUntil ?? null });
    if (data.nextProvider === 'adexium' || data.nextProvider === 'tads') setNextProvider(data.nextProvider);
    return data.nextProvider === 'tads' ? 'tads' : 'adexium';
  }, [initData, isVerified]);

  useEffect(() => {
    void loadCycle().catch((error) => console.error('hybrid_ad_progress_failed', error));
    const refresh = window.setInterval(() => void loadCycle().catch(() => undefined), 15000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(refresh); window.clearInterval(tick); clearTimer(); instanceRef.current?.destroy?.(); };
  }, [clearTimer, loadCycle]);

  const postReward = useCallback(async (provider: Provider, taskId?: string) => {
    if (!pendingRef.current || completedRef.current) return;
    completedRef.current = true;
    clearTimer();
    try {
      const response = await fetch('/api/ads/reward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
        body: JSON.stringify(provider === 'adexium'
          ? { provider, widgetId: ADEXIUM_WID, taskId }
          : { provider, widgetId: TADS_WID, claimId: crypto.randomUUID() }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean; reward?: number; wallet?: { coins?: number }; error?: string;
        cycle?: { used?: number; remaining?: number; cooldownUntil?: number | null; nextProvider?: Provider };
      };
      if (!response.ok || data.ok !== true || !Number.isSafeInteger(data.reward) || !Number.isSafeInteger(data.wallet?.coins)) {
        throw new Error(data.error || 'ad_reward_failed');
      }
      if (data.cycle) {
        setCycle({ used: Number(data.cycle.used ?? 0), remaining: Number(data.cycle.remaining ?? 0), cooldownUntil: data.cycle.cooldownUntil ?? null });
        if (data.cycle.nextProvider) setNextProvider(data.cycle.nextProvider);
      }
      onRewarded(Number(data.reward), Number(data.wallet?.coins));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ad_reward_failed';
      onError(message);
    } finally {
      pendingRef.current = false;
      busyRef.current = false;
      setBusy(false);
      void loadCycle().catch(() => undefined);
    }
  }, [clearTimer, initData, loadCycle, onError, onRewarded]);

  const startTads = useCallback(() => {
    providerRef.current = 'tads';
    pendingRef.current = true;
    clearTimer();
    timeoutRef.current = setTimeout(() => {
      if (!completedRef.current && pendingRef.current) {
        pendingRef.current = false;
        busyRef.current = false;
        setBusy(false);
        onError('no_ad_available');
      }
    }, 120000);
    try {
      renderTadsWidget({ id: String(TADS_WID), type: 'fullscreen' });
    } catch (error) {
      clearTimer();
      pendingRef.current = false;
      busyRef.current = false;
      setBusy(false);
      onError('tads_unavailable');
    }
  }, [clearTimer, onError, startAdexium]);

  const startAdexium = useCallback(async () => {
    const failover = () => {
      if (!pendingRef.current) return;
      clearTimer();
      if (fallbackRef.current) {
        pendingRef.current = false;
        busyRef.current = false;
        setBusy(false);
        onError('no_ad_available');
        return;
      }
      fallbackRef.current = true;
      startTads();
    };
    providerRef.current = 'adexium';
    taskIdRef.current = null;
    try {
      let script = document.querySelector<HTMLScriptElement>('script[data-adexium-sdk="true"]');
      if (!window.AdexiumWidget) {
        if (!script) {
          script = document.createElement('script');
          script.src = 'https://cdn.tgads.space/assets/js/adexium-widget.min.js';
          script.async = true;
          script.dataset.adexiumSdk = 'true';
          document.head.appendChild(script);
        }
        await new Promise<void>((resolve, reject) => {
          if (window.AdexiumWidget) return resolve();
          const onLoad = () => resolve();
          const onError = () => reject(new Error('adexium_sdk_load_failed'));
          script!.addEventListener('load', onLoad, { once: true });
          script!.addEventListener('error', onError, { once: true });
          window.setTimeout(() => reject(new Error('adexium_sdk_timeout')), 10000);
        });
      }
      if (!window.AdexiumWidget) throw new Error('adexium_sdk_unavailable');
      const ad = new window.AdexiumWidget({ wid: ADEXIUM_WID, adFormat: 'interstitial', debug: false });
      instanceRef.current?.destroy?.();
      instanceRef.current = ad;
      ad.on('adReceived', (creative) => {
        if (!pendingRef.current || providerRef.current !== 'adexium') return;
        const id = creative?.id;
        if (!id) { failover(); return; }
        taskIdRef.current = id;
        clearTimer();
        timeoutRef.current = setTimeout(() => {
          if (pendingRef.current && !completedRef.current) {
            pendingRef.current = false;
            busyRef.current = false;
            setBusy(false);
            onError('ad_playback_timeout');
          }
        }, 120000);
        try { ad.displayAd(creative!); } catch { failover(); }
      });
      ad.on('noAdFound', () => {
        if (pendingRef.current && providerRef.current === 'adexium') failover();
      });
      ad.on('adPlaybackCompleted', () => {
        const taskId = taskIdRef.current;
        if (taskId && pendingRef.current && providerRef.current === 'adexium') void postReward('adexium', taskId);
      });
      ad.on('adClosed', () => {
        if (providerRef.current === 'adexium' && pendingRef.current && !completedRef.current) {
          clearTimer();
          pendingRef.current = false;
          busyRef.current = false;
          setBusy(false);
        }
      });
      timeoutRef.current = setTimeout(() => {
        if (pendingRef.current && providerRef.current === 'adexium' && !taskIdRef.current) failover();
      }, 10000);
      ad.requestRewardedAd('interstitial');
    } catch (error) {
      console.warn('Adexium failed; falling back to TADS', error);
      failover();
    }
  }, [clearTimer, onError, postReward, startTads]);

  const start = useCallback(async () => {
    if (busyRef.current || !isVerified || !initData || (cycle?.cooldownUntil && cycle.cooldownUntil > Date.now())) return;
    busyRef.current = true;
    pendingRef.current = true;
    completedRef.current = false;
    fallbackRef.current = false;
    setBusy(true);
    let chosen: Provider = nextProvider;
    try { chosen = (await loadCycle()) ?? nextProvider; } catch { /* retain last known order */ }
    if (chosen === 'adexium') await startAdexium();
    else startTads();
  }, [cycle?.cooldownUntil, initData, isVerified, loadCycle, nextProvider, startAdexium, startTads]);

  const locked = Boolean(cycle?.cooldownUntil && cycle.cooldownUntil > now);
  const left = locked ? Math.max(0, cycle!.cooldownUntil! - now) : 0;
  const countdown = `${String(Math.floor(left / 3600000)).padStart(2, '0')}:${String(Math.floor((left % 3600000) / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;

  const handleTadsReward = useCallback(() => {
    if (pendingRef.current && providerRef.current === 'tads') void postReward('tads');
  }, [postReward]);
  const handleTadsNoAd = useCallback(() => {
    if (pendingRef.current && providerRef.current === 'tads' && !completedRef.current) {
      clearTimer();
      if (!fallbackRef.current) {
        fallbackRef.current = true;
        void startAdexium();
      } else {
        pendingRef.current = false;
        busyRef.current = false;
        setBusy(false);
        onError('no_ad_available');
      }
    }
  }, [clearTimer, onError]);

  return (
    <div className="w-full">
      <TadsWidget id={String(TADS_WID)} type="fullscreen" debug={false} onShowReward={handleTadsReward} onAdsNotFound={handleTadsNoAd} />
      <button type="button" onClick={start} disabled={!isVerified || !initData || busy || locked || cycle?.remaining === 0}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-amber-400/50 bg-gradient-to-r from-[#33213b] to-[#563126] px-4 py-3 text-sm font-black text-amber-50 shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : locked ? <ShieldCheck className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
        {locked ? countdown : busy ? loadingLabel : actionLabel || title}
      </button>
      <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-amber-900/60">
        <span>{cycle ? `${cycle.used}/30` : '…/30'}</span>
        <span>{cycle ? `المتبقي: ${cycle.remaining}` : title}</span>
      </div>
    </div>
  );
}
