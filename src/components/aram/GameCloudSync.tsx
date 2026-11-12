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

type RemoteGameState = {
  exists?: boolean;
  state?: Record<string, unknown> | null;
  wallet?: { coins?: number; oil?: number; locked?: number } | null;
};

function authoritativeState(remote: RemoteGameState, userId: number, userName: string) {
  const current = useGame.getState();
  const restored = remote.exists && remote.state && typeof remote.state === 'object'
    ? remote.state
    : {};
  const merged: Record<string, unknown> = {
    ...restored,
    userId: String(userId),
    userName: userName || current.userName,
  };

  // Wallet balances from the relational Turso wallet override any older
  // denormalized values in the game snapshot. Never coerce missing balances to 0.
  if (remote.wallet && Number.isSafeInteger(remote.wallet.coins) && Number(remote.wallet.coins) >= 0) {
    merged.coins = Number(remote.wallet.coins);
  }
  if (remote.wallet && Number.isSafeInteger(remote.wallet.oil) && Number(remote.wallet.oil) >= 0) {
    merged.oil = Number(remote.wallet.oil);
  }
  return merged;
}

export function GameCloudSync({ initData, userId, userName }: { initData: string; userId: number; userName: string }) {
  useEffect(() => {
    if (!initData || !userId) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let saveQueue: Promise<void> = Promise.resolve();

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
        const remote = await response.json() as RemoteGameState;
        if (disposed) return;

        useGame.setState(authoritativeState(remote, userId, userName) as Partial<ReturnType<typeof useGame.getState>>);

        if (!remote.exists) {
          // Preserve legacy non-ledger state during first-time snapshot creation.
          // The API independently protects ledger-backed wallet balances.
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
            saveQueue = saveQueue.then(() => save(useGame.getState())).catch((error) => {
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
