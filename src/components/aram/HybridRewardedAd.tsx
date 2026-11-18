'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, ShieldCheck } from 'lucide-react';
import { watchMonetagRewardedAd } from '@/lib/monetag-reward';

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

export function HybridRewardedAd({ initData, isVerified, title, actionLabel, loadingLabel, onRewarded, rewardPurpose = 'coins' }: Props) {
  const [busy, setBusy] = useState(false);
  const [cycle, setCycle] = useState<{ used: number; remaining: number; cooldownUntil: number | null } | null>(null);
  const [now, setNow] = useState(Date.now());

  const loadCycle = useCallback(async () => {
    if (!isVerified || !initData) return;
    const response = await fetch('/api/ads/reward', { headers: { 'X-Telegram-Init-Data': initData }, cache: 'no-store' });
    if (!response.ok) throw new Error('ad_progress_unavailable');
    const data = await response.json() as { used?: number; remaining?: number; cooldownUntil?: number | null };
    setCycle({ used: Number(data.used ?? 0), remaining: Number(data.remaining ?? 30), cooldownUntil: data.cooldownUntil ?? null });
  }, [initData, isVerified]);

  useEffect(() => {
    void loadCycle().catch((error) => console.error('monetag_ad_progress_failed', error));
    const refresh = window.setInterval(() => void loadCycle().catch(() => undefined), 15000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(refresh); window.clearInterval(tick); };
  }, [loadCycle]);

  const locked = Boolean(cycle?.cooldownUntil && cycle.cooldownUntil > now);
  const left = locked ? Math.max(0, cycle!.cooldownUntil! - now) : 0;
  const countdown = `${String(Math.floor(left / 3600000)).padStart(2, '0')}:${String(Math.floor((left % 3600000) / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;

  const start = async () => {
    if (busy || !isVerified || !initData || (rewardPurpose === 'coins' && (locked || cycle?.remaining === 0))) return;
    setBusy(true);
    try {
      const result = await watchMonetagRewardedAd(rewardPurpose === 'lucky_wheel' ? {
        initData,
        requestVar: 'lucky_wheel_extra_spin',
        endpoint: '/api/lucky-wheel',
        body: (ymid) => ({ action: 'ad', provider: 'monetag', widgetId: 12295910, ymid }),
      } : {
        initData,
        requestVar: 'task_reward_20_coins',
        endpoint: '/api/ads/reward',
        body: (ymid) => ({ provider: 'monetag', widgetId: 12295910, ymid }),
      });
      onRewarded(result.reward, result.walletCoins);
      if (rewardPurpose === 'coins') await loadCycle();
    } catch (error) {
      console.warn('Monetag rewarded ad failed', error);
      const message = error instanceof Error ? error.message : 'monetag_ad_failed';
      if (message === 'ad_cycle_cooldown' || message === 'ad_cycle_limit_reached') await loadCycle().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full">
      <button type="button" onClick={() => void start()} disabled={!isVerified || !initData || busy || (rewardPurpose === 'coins' && (locked || cycle?.remaining === 0))}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-amber-400/50 bg-gradient-to-r from-[#33213b] to-[#563126] px-4 py-3 text-sm font-black text-amber-50 shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : locked ? <ShieldCheck className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
        {rewardPurpose === 'coins' && locked ? countdown : busy ? loadingLabel : actionLabel || title}
      </button>
      {rewardPurpose === 'coins' && <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-amber-900/60">
        <span>{cycle ? `${cycle.used}/30` : '…/30'}</span>
        <span>{cycle ? `المتبقي: ${cycle.remaining}` : title}</span>
      </div>}
    </div>
  );
}
