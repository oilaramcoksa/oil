'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ExternalLink, Loader2, Play, ShieldCheck } from 'lucide-react';
import { TadsWidget, renderTadsWidget } from 'react-tads-widget';


const ADEXIUM_WID = 'fac3402b-57c4-45be-9d1d-5589a334852d';
const TADS_WID = 13283;
const REWARD = 100;

type Provider = 'adexium' | 'tads' | 'monetag';
type AdexiumAd = { id?: string };
type AdexiumInstance = {
  requestRewardedAd: (format: 'interstitial') => void;
  displayAd: (ads: AdexiumAd[]) => void;
  on: (event: string, callback: (...args: any[]) => void) => void;
  off?: (event: string, callback: (...args: any[]) => void) => void;
  destroy?: () => void;
};
declare global {
  interface Window {
    show_12295910?: (options?: string | { type?: 'end' | 'start' | 'preload' | 'pop' | 'inApp'; ymid?: string; requestVar?: string; inAppSettings?: { frequency: number; capping: number; interval: number; timeout: number; everyPage?: boolean } }) => Promise<{ reward_event_type?: 'valued' | 'non_valued'; event_type?: string; zone_id?: number; telegram_id?: string; variable2?: string } | undefined>;
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
  rewardPurpose?: 'coins' | 'lucky_wheel';
};

export function HybridRewardedAd({ initData, isVerified, title, actionLabel, loadingLabel, onRewarded, onError, rewardPurpose = 'coins' }: Props) {
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
  const switchToAdexiumRef = useRef<() => void>(() => undefined);
  const switchToMonetagRef = useRef<() => void>(() => undefined);
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
    const claimId = provider === 'tads' ? crypto.randomUUID() : taskId;
    const endpoint = rewardPurpose === 'lucky_wheel' ? '/api/lucky-wheel' : '/api/ads/reward';
    const payload = rewardPurpose === 'lucky_wheel'
      ? (provider === 'adexium' ? { action: 'ad', provider, widgetId: ADEXIUM_WID, taskId } : { action: 'ad', provider, widgetId: TADS_WID, claimId })
      : (provider === 'adexium' ? { provider, widgetId: ADEXIUM_WID, taskId } : provider === 'tads' ? { provider, widgetId: TADS_WID, claimId } : { provider, widgetId: 12295910, ymid: taskId });
    try {
      let response: Response | null = null;
      let data: {
        ok?: boolean; reward?: number; wallet?: { coins?: number }; error?: string; adViews?: number;
        cycle?: { used?: number; remaining?: number; cooldownUntil?: number | null; nextProvider?: Provider };
      } = {};
      const delays = [0, 1000, 1800, 3000, 4500, 6000];
      for (let attempt = 0; attempt < delays.length; attempt += 1) {
        if (delays[attempt]) await new Promise((resolve) => window.setTimeout(resolve, delays[attempt]));
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
          body: JSON.stringify(payload),
          cache: 'no-store',
        });
        data = await response.json().catch(() => ({})) as typeof data;
        if (!((provider === 'tads' && data.error === 'tads_view_not_verified') || (provider === 'monetag' && data.error === 'monetag_postback_not_verified')) || response.status !== 409 || attempt === delays.length - 1) break;
      }
      if (!response?.ok || data.ok !== true || (rewardPurpose === 'coins' && (!Number.isSafeInteger(data.reward) || !Number.isSafeInteger(data.wallet?.coins)))) {
        throw new Error(data.error || 'ad_reward_failed');
      }
      if (data.cycle) {
        setCycle({ used: Number(data.cycle.used ?? 0), remaining: Number(data.cycle.remaining ?? 0), cooldownUntil: data.cycle.cooldownUntil ?? null });
        if (data.cycle.nextProvider) setNextProvider(data.cycle.nextProvider);
      }
      onRewarded(Number(data.reward ?? 0), Number(data.wallet?.coins ?? 0));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ad_reward_failed';
      onError(message);
    } finally {
      pendingRef.current = false;
      busyRef.current = false;
      setBusy(false);
      void loadCycle().catch(() => undefined);
    }
  }, [clearTimer, initData, loadCycle, onError, onRewarded, rewardPurpose]);
  const handleTadsReward = useCallback(() => {
    if (pendingRef.current && providerRef.current === 'tads') void postReward('tads');
  }, [postReward]);

  const handleTadsNoAd = useCallback(() => {
    if (!pendingRef.current || providerRef.current !== 'tads' || completedRef.current) return;
    clearTimer();
    fallbackRef.current = true;
    switchToMonetagRef.current();
  }, [clearTimer, onError]);

  const startMonetag = useCallback(async () => {
    if (rewardPurpose !== 'coins') { pendingRef.current = false; busyRef.current = false; setBusy(false); onError('no_ad_available'); return; }
    providerRef.current = 'monetag';
    taskIdRef.current = crypto.randomUUID();
    clearTimer();
    timeoutRef.current = setTimeout(() => {
      if (pendingRef.current && providerRef.current === 'monetag' && !completedRef.current) {
        pendingRef.current = false; busyRef.current = false; setBusy(false); onError('no_ad_available');
      }
    }, 120000);
    try {
      if (!window.show_12295910) throw new Error('monetag_sdk_unavailable');
      const result = await window.show_12295910({ ymid: taskIdRef.current, requestVar: 'rewarded_coins' });
      if (providerRef.current !== 'monetag' || !pendingRef.current || completedRef.current) return;
      if (result?.reward_event_type !== 'valued') throw new Error('monetag_ad_not_valued');
      void postReward('monetag', taskIdRef.current);
    } catch (error) {
      console.warn('Monetag rewarded ad failed', error);
      if (pendingRef.current && providerRef.current === 'monetag' && !completedRef.current) {
        clearTimer(); pendingRef.current = false; busyRef.current = false; setBusy(false);
        onError(error instanceof Error ? error.message : 'monetag_ad_failed');
      }
    }
  }, [clearTimer, initData, onError, postReward, rewardPurpose]);

  const startMonetagPopup = useCallback(() => {
    const showAd = window.show_12295910;
    if (rewardPurpose !== 'coins' || busyRef.current || !isVerified || !initData || !showAd) {
      onError('no_ad_available');
      return;
    }
    busyRef.current = true;
    pendingRef.current = true;
    completedRef.current = false;
    providerRef.current = 'monetag';
    fallbackRef.current = false;
    const ymid = crypto.randomUUID();
    taskIdRef.current = ymid;
    setBusy(true);
    clearTimer();
    timeoutRef.current = setTimeout(() => {
      if (pendingRef.current && providerRef.current === 'monetag' && !completedRef.current) {
        pendingRef.current = false;
        busyRef.current = false;
        setBusy(false);
        onError('ad_playback_timeout');
      }
    }, 120000);
    // Must be invoked synchronously from this button click to avoid popup blocking.
    void showAd({ type: 'pop', ymid, requestVar: 'rewarded_popup' })
      .then((result) => {
        if (!pendingRef.current || providerRef.current !== 'monetag' || completedRef.current) return;
        if (result?.reward_event_type !== 'valued' || (result.variable2 && result.variable2 !== ymid)) {
          throw new Error('monetag_ad_not_valued');
        }
        void postReward('monetag', ymid);
      })
      .catch((error) => {
        if (!pendingRef.current || providerRef.current !== 'monetag' || completedRef.current) return;
        clearTimer();
        pendingRef.current = false;
        busyRef.current = false;
        setBusy(false);
        onError(error instanceof Error ? error.message : 'monetag_popup_failed');
      });
  }, [clearTimer, initData, isVerified, onError, postReward, rewardPurpose]);

  const startTads = useCallback(() => {
    providerRef.current = 'tads';
    pendingRef.current = true;
    clearTimer();
    timeoutRef.current = setTimeout(() => {
      if (!completedRef.current && pendingRef.current && providerRef.current === 'tads') {
        if (!fallbackRef.current) {
          fallbackRef.current = true;
          switchToMonetagRef.current();
        } else {
          pendingRef.current = false;
          busyRef.current = false;
          setBusy(false);
          onError('no_ad_available');
        }
      }
    }, 15000);
    try {
      renderTadsWidget({ id: String(TADS_WID), type: 'fullscreen' });
    } catch (error) {
      console.warn('TADS fullscreen request failed', error);
      handleTadsNoAd();
    }
  }, [clearTimer, handleTadsNoAd, onError]);

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
      startMonetag();
    };
    providerRef.current = 'adexium';
    taskIdRef.current = null;
    try {
      let script = document.querySelector<HTMLScriptElement>('script[data-adexium-sdk="true"], script[src*="adexium-widget.min.js"]');
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
      ad.on('adReceived', (ads) => {
        if (!pendingRef.current || providerRef.current !== 'adexium') return;
        const creatives = Array.isArray(ads) ? ads : [];
        const creative = creatives[0];
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
        try { ad.displayAd(creatives); } catch { failover(); }
      });
      ad.on('noAdFound', () => {
        if (pendingRef.current && providerRef.current === 'adexium') failover();
      });
      ad.on('requestAdError', () => {
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
  }, [clearTimer, onError, postReward, rewardPurpose, startMonetag]);

  useEffect(() => { switchToAdexiumRef.current = () => { void startAdexium(); }; switchToMonetagRef.current = () => { void startMonetag(); }; }, [startAdexium, startMonetag]);

  const start = useCallback(async () => {
    if (busyRef.current || !isVerified || !initData || (rewardPurpose === 'coins' && cycle?.cooldownUntil && cycle.cooldownUntil > Date.now())) return;
    busyRef.current = true;
    pendingRef.current = true;
    completedRef.current = false;
    fallbackRef.current = false;
    setBusy(true);
    let chosen: Provider = rewardPurpose === 'lucky_wheel' ? 'adexium' : nextProvider;
    if (rewardPurpose === 'coins') { try { chosen = (await loadCycle()) ?? nextProvider; } catch { /* retain last known order */ } }
    if (chosen === 'adexium') await startAdexium();
    else startTads();
  }, [cycle?.cooldownUntil, initData, isVerified, loadCycle, nextProvider, rewardPurpose, startAdexium, startTads]);

  const locked = Boolean(cycle?.cooldownUntil && cycle.cooldownUntil > now);
  const left = locked ? Math.max(0, cycle!.cooldownUntil! - now) : 0;
  const countdown = `${String(Math.floor(left / 3600000)).padStart(2, '0')}:${String(Math.floor((left % 3600000) / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;



  return (
    <div className="w-full">
      <TadsWidget id={String(TADS_WID)} type="fullscreen" debug={false} onShowReward={handleTadsReward} onAdsNotFound={handleTadsNoAd} />
      <button type="button" onClick={start} disabled={!isVerified || !initData || busy || (rewardPurpose === 'coins' && (locked || cycle?.remaining === 0))}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-amber-400/50 bg-gradient-to-r from-[#33213b] to-[#563126] px-4 py-3 text-sm font-black text-amber-50 shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : rewardPurpose === 'coins' && locked ? <ShieldCheck className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
        {rewardPurpose === 'coins' && locked ? countdown : busy ? loadingLabel : actionLabel || title}
      </button>
      {rewardPurpose === 'coins' && <button type="button" onClick={startMonetagPopup} disabled={!isVerified || !initData || busy || (locked || cycle?.remaining === 0)}
        title="Monetag Rewarded Popup"
        className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-50/10 px-4 py-2 text-xs font-bold text-amber-100 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
        <ExternalLink className="h-3.5 w-3.5" />
        {actionLabel}
      </button>}
      {rewardPurpose === 'coins' && <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-amber-900/60">
        <span>{cycle ? `${cycle.used}/30` : '…/30'}</span>
        <span>{cycle ? `المتبقي: ${cycle.remaining}` : title}</span>
      </div>}
    </div>
  );
}
