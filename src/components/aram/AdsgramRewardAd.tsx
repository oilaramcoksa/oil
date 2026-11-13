'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Play } from 'lucide-react';

declare global {
  interface Window {
    Adsgram?: {
      init: (options: { blockId: string }) => {
        show: () => Promise<{ done: boolean; description?: string; state?: string; error?: boolean }>;
      };
    };
  }
}

type Props = {
  initData: string;
  isVerified: boolean;
  onRewarded: (reward: number, walletCoins: number) => void;
  onRewardError?: (error: string) => void;
};

const BLOCK_ID = '59642';

export function AdsgramRewardAd({ initData, isVerified, onRewarded, onRewardError }: Props) {
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    const existing = document.querySelector<HTMLScriptElement>('script[data-adsgram-sdk="true"]');
    const markReady = () => { if (!cancelled) setSdkReady(Boolean(window.Adsgram)); };
    if (window.Adsgram) markReady();
    else if (existing) {
      existing.addEventListener('load', markReady);
      existing.addEventListener('error', markReady);
    } else {
      const script = document.createElement('script');
      script.src = 'https://sad.adsgram.ai/js/sad.min.js';
      script.async = true;
      script.dataset.adsgramSdk = 'true';
      script.onload = markReady;
      script.onerror = markReady;
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      existing?.removeEventListener('load', markReady);
      existing?.removeEventListener('error', markReady);
    };
  }, []);

  const refreshCycle = useCallback(async () => {
    if (!isVerified || !initData) return;
    try {
      const response = await fetch('/api/ads/reward', {
        headers: { 'X-Telegram-Init-Data': initData },
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = await response.json() as { cooldownUntil?: number | null };
      setCooldownUntil(data.cooldownUntil ? Number(data.cooldownUntil) : null);
    } catch (error) {
      console.error('AdsGram cycle status failed:', error);
    }
  }, [initData, isVerified]);

  useEffect(() => {
    void refreshCycle();
    const refresh = window.setInterval(() => void refreshCycle(), 15000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(refresh); window.clearInterval(clock); };
  }, [refreshCycle]);

  const locked = Boolean(cooldownUntil && cooldownUntil > now);
  const remaining = locked ? Math.max(0, cooldownUntil! - now) : 0;
  const countdown = `${String(Math.floor(remaining / 3600000)).padStart(2, '0')}:${String(Math.floor((remaining % 3600000) / 60000)).padStart(2, '0')}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`;

  const watch = async () => {
    if (busy || locked) return;
    if (!isVerified || !initData) { onRewardError?.('telegram_auth_required'); return; }
    if (!window.Adsgram) { onRewardError?.('adsgram_sdk_unavailable'); return; }
    setBusy(true);
    try {
      const controller = window.Adsgram.init({ blockId: BLOCK_ID });
      const result = await controller.show();
      if (!result.done || result.error) {
        onRewardError?.('adsgram_not_completed');
        return;
      }
      const claimId = crypto.randomUUID();
      const response = await fetch('/api/ads/reward', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Init-Data': initData,
        },
        body: JSON.stringify({ provider: 'adsgram', widgetId: Number(BLOCK_ID), claimId }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean; reward?: number; wallet?: { coins?: number };
        cycle?: { cooldownUntil?: number | null }; error?: string;
      };
      if (!response.ok || data.ok !== true || !Number.isSafeInteger(data.reward) ||
          !Number.isSafeInteger(data.wallet?.coins)) {
        throw new Error(data.error || 'ad_reward_failed');
      }
      setCooldownUntil(data.cycle?.cooldownUntil ? Number(data.cycle.cooldownUntil) : null);
      onRewarded(Number(data.reward), Number(data.wallet?.coins));
      void refreshCycle();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'adsgram_ad_failed';
      console.error('AdsGram rewarded ad failed:', message);
      onRewardError?.(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={watch}
      disabled={!isVerified || !initData || !sdkReady || busy || locked}
      className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-gradient-to-r from-emerald-600 to-green-500 px-3 py-2 text-xs font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
      {locked ? `اكتملت 10/10 · إعادة التفعيل ${countdown}` : busy ? 'جارٍ تشغيل إعلان AdsGram...' : !sdkReady ? 'جاري تجهيز AdsGram...' : 'مشاهدة إعلان AdsGram · 100 عملة'}
    </button>
  );
}
