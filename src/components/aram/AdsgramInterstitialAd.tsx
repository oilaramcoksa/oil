'use client';

import { useEffect, useState } from 'react';
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

export function AdsgramInterstitialAd({ initData, isVerified, onRewarded, onRewardError }: Props) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const script = document.querySelector<HTMLScriptElement>('script[data-adsgram-sdk="true"]');
    const check = () => { if (!cancelled) setReady(Boolean(window.Adsgram)); };
    if (window.Adsgram) check();
    else if (script) script.addEventListener('load', check);
    else {
      const tag = document.createElement('script');
      tag.src = 'https://sad.adsgram.ai/js/sad.min.js';
      tag.async = true;
      tag.dataset.adsgramSdk = 'true';
      tag.onload = check;
      tag.onerror = check;
      document.head.appendChild(tag);
    }
    return () => { cancelled = true; script?.removeEventListener('load', check); };
  }, []);

  const watch = async () => {
    if (busy) return;
    if (!isVerified || !initData) { onRewardError?.('telegram_auth_required'); return; }
    if (!window.Adsgram) { onRewardError?.('adsgram_sdk_unavailable'); return; }
    setBusy(true);
    try {
      const result = await window.Adsgram.init({ blockId: 'int-59643' }).show();
      if (!result.done || result.error) {
        onRewardError?.('adsgram_interstitial_not_completed');
        return;
      }
      const claimId = crypto.randomUUID();
      const response = await fetch('/api/ads/reward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
        body: JSON.stringify({ provider: 'adsgram', adFormat: 'interstitial', widgetId: 'int-59643', claimId }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean; reward?: number; wallet?: { coins?: number }; error?: string;
      };
      if (!response.ok || data.ok !== true || data.reward !== 50 || !Number.isSafeInteger(data.wallet?.coins)) {
        throw new Error(data.error || 'ad_reward_failed');
      }
      onRewarded(50, Number(data.wallet?.coins));
    } catch (error) {
      onRewardError?.(error instanceof Error ? error.message : 'adsgram_interstitial_failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={watch} disabled={!isVerified || !initData || !ready || busy}
      className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-sky-500/40 bg-gradient-to-r from-sky-600 to-cyan-500 px-3 py-2 text-xs font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
      {busy ? 'جارٍ عرض الإعلان...' : !ready ? 'جاري تجهيز الإعلان...' : 'مشاهدة إعلان Interstitial · 50 عملة'}
    </button>
  );
}
