'use client';

import { useEffect } from 'react';
import { useGame, type Transaction } from '@/lib/store';

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

const PULL_INTERVAL_MS = 2_000;

function snapshot(state: ReturnType<typeof useGame.getState>) {
  const value: Record<string, unknown> = {};
  for (const key of CLOUD_KEYS) value[key] = state[key];
  return value;
}

type RemoteGameState = {
  exists?: boolean;
  revision?: number;
  state?: Record<string, unknown> | null;
  wallet?: { coins?: number; oil?: number; locked?: number } | null;
  ledgerTransactions?: Transaction[];
};

function mergeTransactions(local: Transaction[], remote: Transaction[] = []) {
  const byId = new Map<string, Transaction>();
  for (const tx of remote) {
    if (tx && typeof tx.id === 'string') byId.set(tx.id, tx);
  }
  for (const tx of local) {
    if (tx && typeof tx.id === 'string' && !byId.has(tx.id)) byId.set(tx.id, tx);
  }
  return [...byId.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);
}

function authoritativeState(
  remote: RemoteGameState,
  userId: number,
  userName: string,
  current: ReturnType<typeof useGame.getState>,
  includeSnapshot: boolean,
) {
  const restored = includeSnapshot && remote.exists && remote.state && typeof remote.state === 'object'
    ? remote.state
    : {};
  const merged: Record<string, unknown> = {
    ...(includeSnapshot ? restored : {}),
    userId: String(userId),
    userName: userName || current.userName,
    transactions: mergeTransactions(
      (includeSnapshot && Array.isArray(restored.transactions) ? restored.transactions : current.transactions) as Transaction[],
      remote.ledgerTransactions ?? [],
    ),
  };

  // Turso relational wallet is authoritative on every device and every pull.
  if (remote.wallet && Number.isSafeInteger(remote.wallet.coins) && Number(remote.wallet.coins) >= 0) {
    merged.coins = Number(remote.wallet.coins);
  } else if (!includeSnapshot) {
    merged.coins = current.coins;
  }
  if (remote.wallet && Number.isSafeInteger(remote.wallet.oil) && Number(remote.wallet.oil) >= 0) {
    merged.oil = Number(remote.wallet.oil);
  } else if (!includeSnapshot) {
    merged.oil = current.oil;
  }
  return merged;
}

export function GameCloudSync({ initData, userId, userName }: { initData: string; userId: number; userName: string }) {
  useEffect(() => {
    if (!initData || !userId) return;
    let disposed = false;
    let applyingRemote = false;
    let dirty = false;
    let pulling = false;
    let unsubscribe: (() => void) | undefined;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let saveQueue: Promise<void> = Promise.resolve();
    let lastRevision = 0;
    let last = '';

    const headers = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData };

    const apply = (remote: RemoteGameState, includeSnapshot: boolean) => {
      const current = useGame.getState();
      applyingRemote = true;
      useGame.setState(authoritativeState(remote, userId, userName, current, includeSnapshot) as Partial<ReturnType<typeof useGame.getState>>);
      applyingRemote = false;
      if (includeSnapshot) last = JSON.stringify(snapshot(useGame.getState()));
    };

    const pull = async (initial = false) => {
      if (disposed || pulling) return;
      pulling = true;
      try {
        const response = await fetch('/api/game/state', { headers, cache: 'no-store' });
        if (!response.ok) throw new Error('game_state_load_failed');
        const remote = await response.json() as RemoteGameState;
        if (disposed) return;

        const revision = Number(remote.revision ?? 0);
        const hasNewSnapshot = initial || (revision > lastRevision && !dirty);
        // Pull snapshot revisions when safe, and always pull the relational wallet
        // and latest ledger operations so other devices see financial changes quickly.
        apply(remote, hasNewSnapshot);
        if (hasNewSnapshot) lastRevision = revision;

        if (initial && !remote.exists) {
          const state = useGame.getState();
          await save(state);
        }
      } catch (error) {
        console.error('game_state_cloud_pull_failed', error);
      } finally {
        pulling = false;
      }
    };

    const save = async (state: ReturnType<typeof useGame.getState>) => {
      const sent = JSON.stringify(snapshot(state));
      const response = await fetch('/api/game/state', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ state: JSON.parse(sent) }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('game_state_save_failed');
      const result = await response.json() as { revision?: number };
      lastRevision = Math.max(lastRevision, Number(result.revision ?? 0));
      const currentSnapshot = JSON.stringify(snapshot(useGame.getState()));
      dirty = currentSnapshot !== sent;
      last = currentSnapshot;
      if (dirty && !disposed) scheduleSave();
    };

    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveQueue = saveQueue
          .then(() => save(useGame.getState()))
          .catch((error) => console.error('game_state_cloud_sync_failed', error));
      }, 500);
    };

    void (async () => {
      await pull(true);
      if (disposed) return;

      unsubscribe = useGame.subscribe((state) => {
        if (applyingRemote) return;
        const next = JSON.stringify(snapshot(state));
        if (next === last) return;
        last = next;
        dirty = true;
        scheduleSave();
      });

      // Cross-device near-real-time refresh. Financial balances and ledger history
      // are read from Turso, never trusted from a stale localStorage snapshot.
      pollTimer = setInterval(() => void pull(false), PULL_INTERVAL_MS);
      const onFocus = () => void pull(false);
      window.addEventListener('focus', onFocus);
      window.addEventListener('online', onFocus);
      return () => {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('online', onFocus);
      };
    })();

    return () => {
      disposed = true;
      if (saveTimer) clearTimeout(saveTimer);
      if (pollTimer) clearInterval(pollTimer);
      unsubscribe?.();
    };
  }, [initData, userId, userName]);

  return null;
}
