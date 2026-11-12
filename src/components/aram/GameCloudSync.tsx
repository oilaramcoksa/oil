'use client';

import { useEffect } from 'react';
import { useGame } from '@/lib/store';

const CLOUD_KEYS = [
  'oil', 'coins', 'upgrades', 'tasks', 'referrals', 'transactions',
  'tonAddress', 'withdrawals', 'refundedWithdrawals',
  'tapsToday', 'sellsToday', 'qualifiedSellsToday', 'tapsThisWeek',
  'sellsThisWeek', 'tapsTotal', 'sellsTotal', 'coinsEarnedThisMonth',
  'lastMonthKey', 'lastLoginDay', 'loginStreak', 'luckyBoxLastOpened',
  'totalStoreRevenue', 'tournamentHistory', 'claimedAchievements',
  'cycleEndsAt', 'lastTickAt', 'lang', 'onboarded', 'acceptedDisclaimer',
  'sound', 'vibration',
] as const;

function snapshot(state: ReturnType<typeof useGame.getState>) {
  const value: Record<string, unknown> = {};
  for (const key of CLOUD_KEYS) value[key] = state[key];
  return value;
}

export function GameCloudSync({ initData, userId, userName }: { initData: string; userId: number; userName: string }) {
  useEffect(() => {
    if (!initData || !userId) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    const headers = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData };
    const save = async (state: ReturnType<typeof useGame.getState>) => {
      const response = await fetch('/api/game/state', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ state: snapshot(state) }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('game_state_save_failed');
    };

    void (async () => {
      try {
        const response = await fetch('/api/game/state', { headers, cache: 'no-store' });
        if (!response.ok) throw new Error('game_state_load_failed');
        const remote = await response.json();
        if (disposed) return;

        const current = useGame.getState();
        if (remote.exists && remote.state && typeof remote.state === 'object') {
          useGame.setState({
            ...remote.state,
            userId: String(userId),
            userName: userName || current.userName,
          });
        } else {
          // One-time migration: preserve this device's legacy local save in Turso.
          useGame.setState({ userId: String(userId), userName: userName || current.userName });
          await save(useGame.getState());
        }

        if (disposed) return;
        let last = JSON.stringify(snapshot(useGame.getState()));
        unsubscribe = useGame.subscribe((state) => {
          const next = JSON.stringify(snapshot(state));
          if (next === last) return;
          last = next;
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            void save(state).catch((error) => {
              console.error('game_state_cloud_sync_failed', error);
            });
          }, 700);
        });
      } catch (error) {
        console.error('game_state_cloud_sync_unavailable', error);
      }
    })();

    return () => {
      disposed = true;
      if (saveTimer) clearTimeout(saveTimer);
      unsubscribe?.();
    };
  }, [initData, userId, userName]);

  return null;
}
