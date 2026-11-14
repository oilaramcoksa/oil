'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TadsWidget, renderTadsWidget } from 'react-tads-widget';
import { Megaphone, Play, Loader2 } from 'lucide-react';

type Props = {
  widgetId: number;
  rewardWidgetId?: number;
  mode: 'static' | 'fullscreen';
  title: string;
  description?: string;
  actionLabel?: string;
  loadingLabel?: string;
  className?: string;
  initData?: string;
  isVerified?: boolean;
  onRewarded?: (reward: number, walletCoins: number) => void;
  onRewardError?: (error: string) => void;
};

export function TadsAd({
  widgetId, rewardWidgetId, mode, title, description, actionLabel, loadingLabel,
  className = '', initData = '', isVerified = false, onRewarded, onRewardError,
}: Props) {
  const id = String(widgetId);
  const fullscreenId = String(rewardWidgetId ?? widgetId);
  const claimWidgetId = rewardWidgetId ?? widgetId;
  const [adPending, setAdPending] = useState(false);
  const [rewarding, setRewarding] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [countdownNow, setCountdownNow] = useState(Date.now());
  const pendingRef = useRef(false);
  const rewardInFlightRef = useRef(false);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isVerified || !initData) return;
    let stopped = false;
    const loadCycle = async () => {
      try {
        const response = await fetch('/api/ads/reward', { headers: { 'X-Telegram-Init-Data': initData }, cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json() as { used?: number; cooldownUntil?: number | null };
        if (!stopped) {
          setCooldownUntil(data.cooldownUntil ? Number(data.cooldownUntil) : null);
        }
      } catch (error) { console.error('TADS cycle status failed:', error); }
    };
    void loadCycle();
    const refresh = window.setInterval(() => void loadCycle(), 15000);
    return () => { stopped = true; window.clearInterval(refresh); };
  }, [initData, isVerified]);

  useEffect(() => {
    const timer = window.setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const locked = Boolean(cooldownUntil && cooldownUntil > countdownNow);
  const remainingMs = locked ? Math.max(0, cooldownUntil! - countdownNow) : 0;
  const countdown = `${String(Math.floor(remainingMs / 3600000)).padStart(2, '0')}:${String(Math.floor((remainingMs % 3600000) / 60000)).padStart(2, '0')}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}`;

  const clearPending = useCallback(() => {
    pendingRef.current = false;
    setAdPending(false);
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);

  const handleShow = useCallback(async (_result: unknown) => {
    // TADS invokes onShowReward after the fullscreen ad view is completed.
    if (!pendingRef.current || rewardInFlightRef.current) return;
    clearPending();
    rewardInFlightRef.current = true;
    setRewarding(true);
    try {
      if (!isVerified || !initData) throw new Error('telegram_auth_required');
      const response = await fetch('/api/ads/reward', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Init-Data': initData,
        },
        body: JSON.stringify({ widgetId: claimWidgetId, claimId: crypto.randomUUID() }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        reward?: number;
        wallet?: { coins?: number };
        cycle?: { used?: number; cooldownUntil?: number | null };
        error?: string;
      };
      if (!response.ok || data.ok !== true || !Number.isSafeInteger(data.reward) ||
          !Number.isSafeInteger(data.wallet?.coins)) {
        throw new Error(data.error || 'ad_reward_failed');
      }
      if (data.cycle) {
        setCooldownUntil(data.cycle.cooldownUntil ? Number(data.cycle.cooldownUntil) : null);
      }
      onRewarded?.(Number(data.reward), Number(data.wallet?.coins));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ad_reward_failed';
      console.error('TADS reward could not be credited:', message);
      onRewardError?.(message);
    } finally {
      rewardInFlightRef.current = false;
      setRewarding(false);
    }
  }, [clearPending, initData, isVerified, onRewarded, onRewardError, claimWidgetId]);

  const handleNotFound = useCallback(() => {
    // The fullscreen widget can report no-fill while it initializes. Only
    // surface this as the result of a user request while a request is pending.
    if (!pendingRef.current) {
      console.info('TADS fullscreen: no ad available during initialization');
      return;
    }
    clearPending();
    onRewardError?.('no_ad_available');
  }, [clearPending, onRewardError]);

  const handleStaticNotFound = useCallback(() => {
    // A missing TGB placement must not cancel or fail a fullscreen reward.
    console.info('TADS TGB: no ad available');
  }, []);

  const showFullscreen = useCallback(() => {
    if (adPending || rewarding || locked || pendingRef.current || rewardInFlightRef.current) return;
    if (!isVerified || !initData) {
      onRewardError?.('telegram_auth_required');
      return;
    }
    pendingRef.current = true;
    setAdPending(true);
    pendingTimerRef.current = setTimeout(() => {
      clearPending();
      onRewardError?.('ad_timeout');
    }, 120000);
    try {
      renderTadsWidget({ id: fullscreenId, type: 'fullscreen' });
    } catch (error) {
      clearPending();
      console.warn('TADS fullscreen could not be opened', error);
      onRewardError?.('ad_unavailable');
    }
  }, [adPending, clearPending, fullscreenId, initData, isVerified, locked, onRewardError, rewarding]);

  if (mode === 'static') {
    return (
      <section className={`w-full overflow-hidden rounded-2xl border border-amber-300/60 bg-white/90 p-2 shadow-sm ${className}`} aria-label={title}>
        <div className="mb-1 flex items-center gap-1.5 text-[9px] font-black text-amber-900/60">
          <Megaphone className="h-3 w-3" /> {title}
        </div>
        <TadsWidget
          id={id}
          type="static"
          debug={false}
          onAdsNotFound={handleStaticNotFound}
        />
        {rewardWidgetId && (
          <div className="w-full" aria-hidden="true">
            <TadsWidget
              id={fullscreenId}
              type="fullscreen"
              debug={false}
              onShowReward={handleShow}
              onAdsNotFound={handleNotFound}
            />
          </div>
        )}
        {description && <p className="sr-only">{description}</p>}
        {rewardWidgetId && (
          <div className="mt-2">
            <button
              type="button"
              onClick={showFullscreen}
              disabled={!isVerified || !initData || adPending || rewarding || locked}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-400/50 bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-2 text-xs font-black text-[#3b210c] shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {adPending || rewarding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
              {locked ? `اكتملت 30/30 · إعادة التفعيل ${countdown}` : (rewarding ? (loadingLabel ?? 'جاري إضافة المكافأة...') : (actionLabel ?? title))}
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className={className}>
      <TadsWidget
        id={id}
        type="fullscreen"
        debug={false}
        onShowReward={handleShow}
        onAdsNotFound={handleNotFound}
      />
      <button
        type="button"
        onClick={showFullscreen}
        disabled={!isVerified || !initData || adPending || rewarding || locked}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-amber-400/50 bg-gradient-to-r from-[#33213b] to-[#563126] px-4 py-3 text-sm font-black text-amber-50 shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {adPending || rewarding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
        {locked ? `اكتملت 30/30 · إعادة التفعيل ${countdown}` : (rewarding ? (loadingLabel ?? 'جاري إضافة المكافأة...') : (actionLabel ?? title))}
      </button>
      {description && <p className="mt-1 text-center text-[10px] font-bold text-amber-900/55">{description}</p>}
    </div>
  );
}
