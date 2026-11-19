'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Coins, History, Loader2, Users, Zap, ShoppingCart } from 'lucide-react';
import type { TonConnectUI } from '@tonconnect/ui';
import { getTonConnectUI } from '@/lib/ton-connect';
import { beginCell } from '@ton/core';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useGame } from '@/lib/store';
import { t, dirOf } from '@/lib/i18n';
import { isValidArenaEntryAmount, MIN_ARENA_ENTRY } from '@/lib/arena-settlement.mjs';

type Entry = { telegramId: string; username: string; amount: number; photoUrl?: string | null };
type Round = {
  id: string;
  status: 'open' | 'countdown' | 'spinning';
  startsAt: number | null;
  spinStartedAt: number | null;
  totalEntries: number;
  entriesCount: number;
  winnerType: string | null;
  winnerTelegramId: string | null;
  wheelStopDegrees: number | null;
};
type LastResult = {
  id: string;
  winnerType: string;
  winnerTelegramId: string | null;
  totalEntries: number;
  wheelStopDegrees: number;
  entries: Entry[];
};
type HistoryEntry = { telegramId: string; username: string; stake: number; outcome: 'win' | 'loss' | 'refund'; amount: number; multiplier: number };
type HistoryRound = { id: string; status: string; occurredAt: string; total: number; winnerTelegramId: string | null; winnerType: string | null; fee: number; netWinnings: number; entries: HistoryEntry[] };
type ArenaState = {
  round: Round | null;
  balance: number;
  betBalance: number;
  entries: Entry[];
  lastResult: LastResult | null;
};

function wheelStopForWinner(entries: Entry[], winnerType: string | null, winnerTelegramId: string | null): number {
  if (winnerType === 'house') return 45;
  if (!winnerTelegramId || entries.length === 0) return 0;
  const winnerIndex = entries.findIndex((entry) => entry.telegramId === winnerTelegramId);
  if (winnerIndex < 0) return 0;
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  if (total <= 0) return 0;
  const beforeWinner = entries.slice(0, winnerIndex).reduce((sum, entry) => sum + entry.amount, 0);
  const winnerCenter = ((beforeWinner + entries[winnerIndex].amount / 2) / total) * 270;
  return (360 - winnerCenter) % 360;
}

const EMPTY_STATE: ArenaState = { round: null, balance: 0, betBalance: 0, entries: [], lastResult: null };

export function ArenaScreen({
  initData,
  isVerified,
  telegramUserId,
  }: {
  initData: string;
  isVerified: boolean;
  telegramUserId: string;
}) {
  const lang = useGame((s) => s.lang);
  
  const [state, setState] = useState<ArenaState>(EMPTY_STATE);
  const [amount, setAmount] = useState('100');
  const joinLock = useRef(false);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [history, setHistory] = useState<HistoryRound[]>([]);
  const [replaying, setReplaying] = useState(false);
  const [replayNonce, setReplayNonce] = useState(0);
  const [tonConnector, setTonConnector] = useState<TonConnectUI | null>(null);
  const [buyingTokens, setBuyingTokens] = useState(false);
  const headers = useMemo(() => ({ 'X-Telegram-Init-Data': initData }), [initData]);

  useEffect(() => {
    let alive = true;
    void getTonConnectUI().then((connector) => { if (alive) setTonConnector(connector); }).catch((error) => console.error('arena_tonconnect_init_failed', error));
    return () => { alive = false; };
  }, []);

  const buyArenaTokens = async () => {
    if (buyingTokens) return;
    const telegramInitData = initData || (typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData ?? '' : '');
    if (!telegramInitData) { toast.error(t(lang, 'telegramRequired')); return; }
    if (!tonConnector) { toast.error(t(lang, 'walletNotReady')); return; }
    if (!tonConnector.connected) { await tonConnector.openModal(); toast.info(t(lang, 'walletConnectFirst')); return; }
    setBuyingTokens(true);
    try {
      const response = await fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': telegramInitData }, body: JSON.stringify({ itemId: 'arena_tokens_10000' }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.payment?.id) throw new Error(data.error ?? 'payment_request_failed');
      const payment = data.payment;
      const accountAddress = tonConnector.account?.address;
      if (!accountAddress) throw new Error('wallet_not_connected');
      const balanceUrl = new URL('https://toncenter.com/api/v2/getAddressBalance'); balanceUrl.searchParams.set('address', accountAddress);
      const balanceResponse = await fetch(balanceUrl.toString(), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const balanceData = await balanceResponse.json().catch(() => ({})) as { ok?: boolean; result?: string };
      if (!balanceResponse.ok || balanceData.ok !== true || !/^\d+$/.test(String(balanceData.result ?? ''))) throw new Error('wallet_balance_unavailable');
      if (BigInt(String(balanceData.result)) < BigInt(String(payment.amountNanoton)) + 50_000_000n) throw new Error('insufficient_ton_balance');
      const payload = beginCell().storeUint(0, 32).storeStringTail(String(payment.comment)).endCell().toBoc().toString('base64');
      await tonConnector.sendTransaction({ validUntil: Math.floor(Date.now() / 1000) + 600, network: '-239', messages: [{ address: String(payment.destination), amount: String(payment.amountNanoton), payload }] });
      toast.info(t(lang, 'paymentSentVerifying'));
      const startedAt = Date.now();
      const poll = async (): Promise<void> => {
        try {
          const statusResponse = await fetch('/api/payments?id=' + encodeURIComponent(String(payment.id)), { headers: { 'X-Telegram-Init-Data': telegramInitData }, cache: 'no-store' });
          const statusData = await statusResponse.json().catch(() => ({}));
          if (!statusResponse.ok) throw new Error(statusData.error ?? 'payment_status_unavailable');
          if (statusData.payment?.status === 'confirmed') { setBuyingTokens(false); await refresh(); toast.success(t(lang, 'paymentConfirmedToast')); return; }
          if (['expired', 'rejected'].includes(String(statusData.payment?.status)) || Date.now() - startedAt > 35 * 60 * 1000) { setBuyingTokens(false); toast.error(t(lang, 'paymentExpiredToast')); return; }
          window.setTimeout(() => { void poll(); }, 7000);
        } catch { if (Date.now() - startedAt > 35 * 60 * 1000) { setBuyingTokens(false); toast.error(t(lang, 'paymentVerifyFailedToast')); } else window.setTimeout(() => { void poll(); }, 10000); }
      };
      void poll();
    } catch (error) {
      setBuyingTokens(false);
      const message = String((error as { message?: string })?.message ?? '');
      if (message === 'insufficient_ton_balance') toast.error(t(lang, 'walletNotEnoughTon'));
      else if (message === 'wallet_balance_unavailable') toast.error(t(lang, 'walletBalanceUnavailable'));
      else if (message === 'wallet_not_connected') toast.error(t(lang, 'walletNotConnected'));
      else if (/UserRejectsError|user rejected|user declined/i.test(message)) toast.info(t(lang, 'paymentRejectedToast'));
      else { console.error('arena_token_purchase_failed', error); toast.error(t(lang, 'purchaseGenericError')); }
    }
  };

  const refreshHistory = useCallback(async () => {
    if (!isVerified || !initData) return;
    const response = await fetch('/api/arena/history', { headers, cache: 'no-store' });
    if (!response.ok) throw new Error('arena_history_failed');
    const data = await response.json() as { rounds?: HistoryRound[] };
    setHistory(Array.isArray(data.rounds) ? data.rounds : []);
  }, [headers, initData, isVerified]);

  useEffect(() => {
    if (!isVerified) return;
    let stopped = false;
    const load = async () => {
      try { if (!stopped) await refreshHistory(); }
      catch (error) { console.error('arena_history_refresh_failed', error); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [isVerified, refreshHistory]);


  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refresh = useCallback((): Promise<void> => {
    if (!isVerified || !initData) return Promise.resolve();
    if (refreshInFlight.current) return refreshInFlight.current;
    const request = (async () => {
      try {
        const response = await fetch('/api/arena', { headers, cache: 'no-store' });
        if (!response.ok) throw new Error('arena_state_failed');
        const data = await response.json() as ArenaState;
        setState(data);
      } finally {
        refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = request;
    return request;
  }, [headers, initData, isVerified]);

  useEffect(() => {
    if (!isVerified) return;
    let stopped = false;
    const poll = async () => {
      try {
        if (!stopped) await refresh();
      } catch (error) {
        console.error('arena_refresh_failed', error);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [isVerified, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const round = state.round;
  const activeEntries = state.entries;
  const displayedEntries = replaying && state.lastResult
    ? state.lastResult.entries
    : round ? activeEntries : [];
  const total = displayedEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const balance = state.balance;
  const betBalance = state.betBalance;
  const availableBalance = balance + betBalance;
  const ownEntry = activeEntries.some((entry) => entry.telegramId === telegramUserId);
  const countdown = round?.startsAt
    ? Math.max(0, Math.ceil((round.startsAt - now) / 1000))
    : null;
  const isSpinning = round?.status === 'spinning' || replaying;
  // Derive the visual stop from the recorded winner and the exact same
  // entry order/weights used to draw the sectors. This also corrects replay
  // positioning for historical rounds saved with the old 90-degree offset.
  const displayStop = replaying && state.lastResult
    ? wheelStopForWinner(state.lastResult.entries, state.lastResult.winnerType, state.lastResult.winnerTelegramId)
    : round
      ? round.winnerTelegramId
        ? wheelStopForWinner(displayedEntries, round.winnerType, round.winnerTelegramId)
        : (round.wheelStopDegrees ?? 0)
      : state.lastResult
        ? wheelStopForWinner(state.lastResult.entries, state.lastResult.winnerType, state.lastResult.winnerTelegramId)
        : 0;
  const wheelColors = ['#2457f5', '#8b5cf6', '#0ea5e9', '#10b981', '#ec4899', '#ef4444', '#14b8a6', '#6366f1'];
  const wheelEntries = [
    { id: 'house', label: t(lang, 'arenaAdminSlice'), weight: 25, house: true, photoUrl: null, color: '#f59e0b' },
    ...displayedEntries.map((entry, index) => ({
      id: entry.telegramId,
      label: entry.username,
      weight: 75 * (entry.amount / Math.max(total, 1)),
      house: false,
      photoUrl: entry.photoUrl ?? null,
      color: wheelColors[index % wheelColors.length],
    })),
  ];

  const avatarSize = Math.max(24, Math.min(40, 360 / Math.max(wheelEntries.length, 1)));

  const wheelGradient = useMemo(() => {
    let cursor = 0;
    const stops = wheelEntries.map((entry) => {
      const start = cursor;
      cursor += entry.weight;
      return `${entry.color} ${start}% ${cursor}%`;
    });
    if (cursor < 100) stops.push(`#252a3a ${cursor}% 100%`);
    return `conic-gradient(from -90deg, ${stops.join(', ')})`;
  }, [displayedEntries, lang]);

  const join = async (requestedAmount?: number) => {
    const entryAmount = requestedAmount ?? Number(amount);
    if (joinLock.current || loading) return;
    if (!isValidArenaEntryAmount(entryAmount)) {
      toast.error(t(lang, 'arenaMin'));
      return;
    }
    joinLock.current = true;
    setLoading(true);
    try {
      const response = await fetch('/api/arena', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: entryAmount }),
      });
      const data = await response.json() as { balance?: number; error?: string };
      if (!response.ok) {
        console.error('arena_join_rejected', { status: response.status, error: data.error ?? 'unknown' });
        const errorKey = (data.error === 'insufficient_balance' || data.error === 'insufficient_bet_balance')
          ? 'arenaInsufficient'
          : data.error === 'already_joined'
            ? 'arenaJoinedAlready'
            : data.error === 'round_starting'
              ? 'arenaRoundStarted'
              : data.error === 'minimum_100_required'
                ? 'arenaMin'
                : 'arenaError';
        toast.error(t(lang, errorKey));
        return;
      }
      setAmount('100');
      await refresh();
      toast.success(t(lang, 'arenaJoined'));
    } catch (error) {
      console.error('arena_join_ui_failed', error);
      toast.error(t(lang, 'arenaError'));
    } finally {
      joinLock.current = false;
      setLoading(false);
    }
  };

  const cancelWaitingEntry = async () => {
    if (!canCancelWaitingEntry || joinLock.current) return;
    joinLock.current = true;
    setLoading(true);
    try {
      const response = await fetch('/api/arena', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', roundId: round?.id }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        const code = data.error ?? '';
        if (code === 'cancellation_locked_second_player_joined') toast.error(t(lang, 'arenaCancelLocked'));
        else if (code === 'entry_not_found' || code === 'no_cancellable_round') toast.info(lang === 'ar' ? 'تم تحديث حالة الجولة، لا يوجد رهان قابل للإلغاء.' : 'The round was updated; there is no entry to cancel.');
        else if (code === 'telegram_auth_required' || response.status === 401) toast.error(lang === 'ar' ? 'انتهت جلسة التطبيق. أغلق اللعبة وافتحها من البوت مرة أخرى.' : 'Your session expired. Close and reopen the app from the bot.');
        else toast.error(t(lang, 'arenaCancelError'));
        await refresh().catch(() => undefined);
        return;
      }
      await refresh();
      toast.success(t(lang, 'arenaCancelled'));
    } catch (error) {
      console.error('arena_cancel_failed', error);
      toast.error(t(lang, 'arenaCancelError'));
    } finally {
      joinLock.current = false;
      setLoading(false);
    }
  };

  const isRoundClosed = Boolean(round && (round.status === 'spinning' || (round.startsAt !== null && round.startsAt <= now)));
  const canCancelWaitingEntry = Boolean(round?.status === 'open' && ownEntry && displayedEntries.length === 1 && !loading);
  const spinRemaining = replaying ? 7 : round?.spinStartedAt
    ? Math.max(0.2, (round.spinStartedAt + 7_000 - now) / 1_000)
    : 7;

  return (
    <div className="h-full w-full min-w-0 overflow-x-hidden overflow-y-auto overscroll-x-none bg-transparent px-3 pt-4 pb-6 text-amber-50" dir={dirOf(lang)}>
      <div className="relative">
        <div>
          <div className="mx-auto w-full max-w-md">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 bg-gradient-to-b from-[#fff3c4] to-[#f5b83d] bg-clip-text text-xl font-black tracking-tight text-transparent"><i aria-hidden="true" className="live-dot h-2 w-2 rounded-full bg-emerald-400"/>{t(lang, 'arenaTitle')}</h2>
            <p className="mt-1 text-xs text-white/55">{t(lang, 'arenaSubtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            {state.lastResult && !replaying && (
              <button
                type="button"
                onClick={() => {
                  setReplayNonce((value) => value + 1);
                  setReplaying(true);
                  window.setTimeout(() => setReplaying(false), 7_600);
                }}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-amber-300/40 bg-amber-300/15 px-3 text-[11px] font-black text-amber-100"
              >
                <History size={15} />
                {t(lang, 'arenaReplay')}
              </button>
            )}
            <button
              onClick={() => void refresh()}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/10 text-amber-100"
              aria-label={t(lang, 'arenaRecent')}
            >
              <History size={18} />
            </button>
          </div>
        </header>

        <section className="mb-4 overflow-hidden game-panel p-3 text-amber-50 shadow-[0_10px_26px_rgba(0,0,0,.4)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-100 text-amber-300"><Users size={18}/></span>
              <div><div className="text-sm font-extrabold">{t(lang, 'arenaRoundLabel')}</div><div className="mt-0.5 text-[10px] text-white/45">{t(lang, 'arenaPlayers')}: {displayedEntries.length}</div></div>
            </div>
            <span className="rounded-full border border-emerald-300/25 bg-emerald-400/15 px-3 py-1 text-[10px] font-bold text-emerald-200">{replaying ? t(lang, 'arenaReplayPlaying') : round?.status === 'open' ? t(lang, 'arenaWaitingPlayer') : round?.status === 'countdown' ? t(lang, 'arenaCountdown') : isSpinning ? t(lang, 'arenaSpinning') : t(lang, 'arenaReady')}</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-amber-200/10 bg-amber-300/10 p-2"><div className="text-[9px] leading-tight text-white/50">{t(lang, 'arenaPot')}</div><div key={total} className="count-pop mt-1 text-base font-black tabular-nums text-amber-300">{total.toLocaleString()}</div></div>
            <div className="rounded-xl border border-emerald-300/15 bg-emerald-400/10 p-2"><div className="text-[9px] leading-tight text-emerald-200">{t(lang, 'arenaPurchasedBalance')}</div><div className="mt-1 text-base font-black tabular-nums text-emerald-200">{betBalance.toLocaleString()}</div></div>
            <div className="rounded-xl border border-blue-300/15 bg-blue-400/10 p-2"><div className="text-[9px] leading-tight text-blue-200">{t(lang, 'arenaWalletBalance')}</div><div className="mt-1 text-base font-black tabular-nums text-blue-200">{balance.toLocaleString()}</div></div>
          </div>
        </section>

        {round?.status === 'open' && (
          <div className="mx-auto mb-3 max-w-md rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-center text-[11px] font-bold leading-relaxed text-amber-100">
            {t(lang, 'arenaWaitingNoExpiry')}
          </div>
        )}
        <div className="relative mx-auto my-7 aspect-square w-full max-w-[390px] min-w-0 overflow-visible [perspective:1000px]"><div aria-hidden="true" className={"pointer-events-none absolute -inset-4 rounded-full bg-amber-400/20 blur-2xl "+(isSpinning?"wheel-glow":"opacity-50")}/>
          {/* Floating pointer with a metallic highlight */}
          <motion.div
            animate={isSpinning ? { y: [0, 5, 0], scale: [1, 0.96, 1] } : { y: [0, -2, 0] }}
            transition={isSpinning ? { duration: 0.45, repeat: Infinity, ease: 'easeInOut' } : { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -top-3 left-1/2 z-30 -translate-x-1/2 drop-shadow-[0_5px_5px_rgba(0,0,0,.8)]"
          >
            <div className="h-0 w-0 border-x-[18px] border-t-[31px] border-x-transparent border-t-[#fff7df]" />
            <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-white shadow-[0_0_9px_3px_rgba(255,255,255,.65)]" />
          </motion.div>

          {/* Deep 3D base, machined metal rim and inner light ring */}
          <div className="absolute inset-0 translate-y-[10px] rounded-full bg-gradient-to-b from-[#a95e24] via-[#744018] to-[#51290f] shadow-[0_18px_24px_rgba(111,57,18,.28)]" />
          <div className="absolute inset-0 rounded-full border-[10px] border-[#b87937] bg-gradient-to-br from-[#fff0c7] via-[#c78b48] to-[#8b4b1e] shadow-[inset_0_3px_7px_rgba(255,255,255,.8),0_0_0_2px_rgba(130,72,28,.28),0_16px_28px_rgba(111,57,18,.3)]" />
          <div className="absolute inset-[7px] rounded-full border border-[#fff0cb]/80 shadow-[inset_0_0_0_2px_rgba(255,255,255,.28),0_0_16px_rgba(255,205,120,.3)]" />

          <motion.div
            key={replaying ? `replay-${replayNonce}` : round?.id ?? state.lastResult?.id ?? 'wheel'}
            initial={replaying ? { rotate: 0 } : false}
            animate={
              isSpinning
                ? { rotate: 2_880 + displayStop }
                : state.lastResult && !round
                  ? { rotate: displayStop }
                  : { rotate: 0 }
            }
            transition={
              isSpinning
                ? { duration: spinRemaining, ease: [0.08, 0.72, 0.12, 1] }
                : state.lastResult && !round
                  ? { duration: 0.35, ease: 'easeOut' }
                  : { duration: 0 }
            }
            className="absolute inset-[11px] overflow-hidden rounded-full border-[3px] border-[#f8dba5]/90 shadow-[inset_0_0_18px_rgba(107,57,15,.18),0_4px_12px_rgba(120,53,15,.2)]"
            style={{ background: wheelGradient, transformStyle: 'preserve-3d', backfaceVisibility: 'hidden' }}
          >
            {/* Radial depth, glass reflection and engraved segment separators */}
            <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(ellipse_at_32%_18%,rgba(255,255,255,.42),transparent_36%),radial-gradient(ellipse_at_50%_50%,transparent_48%,rgba(110,55,10,.18)_100%)]" />
            <div className="pointer-events-none absolute inset-[3px] rounded-full border border-white/25 shadow-[inset_0_2px_8px_rgba(255,255,255,.22),inset_0_-12px_22px_rgba(0,0,0,.22)]" />
            {wheelEntries.map((entry, index) => {
              const segmentStart = wheelEntries.slice(0, index).reduce((sum, item) => sum + item.weight, 0);
              // Match the exact CSS conic-gradient(from -90deg) sector midpoint.
              // Using the same angle convention keeps player photos inside their own slices,
              // never inside the reserved 25% house/burn sector.
              const angle = (-90 + (segmentStart + entry.weight / 2) * 3.6) * Math.PI / 180;
              const avatarLeft = 50 + Math.sin(angle) * 34;
              const avatarTop = 50 - Math.cos(angle) * 34;
              return (
                <div
                  key={entry.id}
                  className="absolute z-[5] grid place-items-center"
                  style={{ left: `${avatarLeft}%`, top: `${avatarTop}%`, width: avatarSize, height: avatarSize, transform: 'translate(-50%, -50%)' }}
                  title={entry.house ? entry.label : `${entry.label} · ${entry.weight.toFixed(1)}%`}
                >
                  {entry.house ? (
                    <span className="grid h-10 w-10 place-items-center rounded-full border-[3px] border-amber-100 bg-gradient-to-br from-yellow-200 via-amber-400 to-orange-600 text-xl text-amber-950 shadow-[0_4px_12px_rgba(0,0,0,.55),inset_0_2px_3px_rgba(255,255,255,.8)]">🔥</span>
                  ) : entry.photoUrl ? (
                    <span className="rounded-full bg-gradient-to-br from-white via-amber-100 to-amber-700 p-[3px] shadow-[0_4px_12px_rgba(92,48,15,.35)] ring-2 ring-white/70">
                      <img src={entry.photoUrl} alt={entry.label} referrerPolicy="no-referrer" className="rounded-full border border-white/90 object-cover" style={{ width: Math.max(18, avatarSize - 6), height: Math.max(18, avatarSize - 6) }} />
                    </span>
                  ) : (
                    <span className="grid place-items-center rounded-full border-[3px] border-white/90 bg-gradient-to-br from-[#fff3d6] via-[#e8a64f] to-[#a95720] font-black text-[#542b12] shadow-[0_4px_12px_rgba(92,48,15,.35)]" style={{ width: avatarSize, height: avatarSize, fontSize: Math.max(10, avatarSize * 0.38) }}>{entry.label.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
              );
            })}
            {/* Soft moving sheen, visible while spinning */}
            {isSpinning && <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-[-30%] z-[3] rounded-full bg-[linear-gradient(115deg,transparent_38%,rgba(255,255,255,.17)_49%,transparent_60%)]"
              animate={{ x: ['-35%', '35%'] }}
              transition={{ duration: 1.1, repeat: Infinity, repeatType: 'mirror', ease: 'linear' }}
            />}
          </motion.div>

          {/* Raised center cap: compact countdown and participant count */}
          <div className="absolute inset-[35%] z-20 flex flex-col items-center justify-center rounded-full border-[5px] border-[#fff0cf] bg-[radial-gradient(circle_at_32%_22%,#fff4d8,#e6b875_58%,#a95c27)] text-[#542b12] shadow-[0_0_0_5px_rgba(126,68,27,.24),inset_0_3px_7px_rgba(255,255,255,.65),0_9px_22px_rgba(111,57,18,.35)]">
            <div className="mb-1 grid h-7 w-7 place-items-center rounded-full border border-amber-700/20 bg-amber-100 text-amber-300">
              {isSpinning ? <Zap size={15}/> : <Users size={15}/>}
            </div>
            {round?.status === 'countdown' && <div className="text-center text-lg font-black tabular-nums leading-none">{String(countdown ?? 0).padStart(2, '0')}</div>}
            {isSpinning && <div className="text-center text-lg font-black"><Zap size={18} className="mx-auto animate-pulse" /></div>}
            <div className="mt-2 flex items-center justify-center gap-1 text-[11px] font-bold leading-none text-[#8b613d]">
              <span>{displayedEntries.length}</span>
              <Users size={12} className="shrink-0 text-amber-300" />
            </div>
          </div>
        </div>

        {state.lastResult && !replaying && (
          <section className="mb-3 rounded-2xl border border-emerald-300/25 bg-gradient-to-r from-emerald-500/15 to-amber-400/10 p-4 text-center text-emerald-100 shadow-md">
            <div className="text-lg font-black">🏆 {t(lang, 'arenaLastRoundResult')}</div>
            <div className="mt-1 text-sm font-extrabold">
              {state.lastResult.winnerType === 'house'
                ? t(lang, 'arenaAdminSlice')
                : state.lastResult.entries.find((entry) => entry.telegramId === state.lastResult?.winnerTelegramId)?.username ?? t(lang, 'arenaWinnerAnnounced')}
            </div>
            <div className="mt-1 text-[10px] text-emerald-200">{t(lang, 'arenaRoundCompleted')}</div>
          </section>
        )}

        <section className="mb-3 game-panel p-3 text-amber-50 shadow-[0_10px_26px_rgba(0,0,0,.4)]">
          <div className="mb-2 flex items-center justify-between text-xs text-white/55">
            <span className="flex items-center gap-1"><Coins size={13} /> {t(lang, 'arenaPot')}</span>
            <strong className="text-base font-black text-amber-300">{total.toLocaleString()}</strong>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/4 bg-gradient-to-r from-amber-300 via-orange-400 to-amber-500" />
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-white/55">
            <span>{t(lang, 'arenaBurnSlice')}</span><span>25%</span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-white/55">{t(lang, 'arenaAdminNote')}</p>
        </section>

        <section className="mb-3 rounded-xl border border-emerald-300/20 bg-gradient-to-r from-[#0f2b2a] to-[#10243a] p-3 text-emerald-50 shadow-md">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-black">{t(lang, 'arenaBuyTokensStore')}</div>
              <p className="mt-1 text-[10px] leading-relaxed text-emerald-200">{t(lang, 'arenaBuyTokenDescription')}</p>
              <div className="mt-1 text-xs font-black text-emerald-100">10,000 · 1 TON</div>
            </div>
            <button type="button" onClick={() => void buyArenaTokens()} disabled={buyingTokens || !isVerified}
              className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-emerald-500 to-teal-600 px-4 py-3 text-xs font-black text-white shadow-md disabled:opacity-50">
              {buyingTokens ? <Loader2 size={15} className="animate-spin" /> : <ShoppingCart size={15} />}
              {buyingTokens ? t(lang, 'paymentSentVerifying') : t(lang, 'arenaBuyTokensButton')}
            </button>
          </div>
          <p className="mt-2 text-[9px] text-emerald-100/60">{t(lang, 'arenaBuyTokensFootnote')}</p>
        </section>

        <section className="mb-3 game-panel p-3 text-amber-50 shadow-[0_10px_26px_rgba(0,0,0,.4)]">
          <div className="mb-2 flex justify-between text-xs text-white/55">
            <span>{t(lang, 'arenaAmount')}</span><span>{t(lang, 'arenaAvailableBalance')}: <b className="font-black text-amber-300">{availableBalance.toLocaleString()}</b> <span className="text-[9px]">{t(lang, 'singleBalance')}</span></span>
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={MIN_ARENA_ENTRY}
              max={availableBalance}
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={ownEntry || isRoundClosed}
              className="min-w-0 flex-1 rounded-lg border border-[#6b3b19] bg-[#25262a] p-3 font-black text-white caret-white outline-none placeholder:text-white/50 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30"
            />
            <button
              onClick={() => void join(availableBalance)}
              disabled={loading || !isVerified || ownEntry || isRoundClosed || availableBalance < MIN_ARENA_ENTRY}
              className="rounded-xl border border-amber-600 bg-gradient-to-b from-amber-400 to-orange-500 px-4 text-xs font-black text-[#3b210c] shadow-md disabled:opacity-40"
            >
              {t(lang, 'arenaMax')}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2" aria-label={t(lang, 'arenaQuickAmounts')}>
            {[100, 500, 1000, 5000].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(String(preset))}
                disabled={loading || !isVerified || ownEntry || isRoundClosed || preset > availableBalance}
                aria-pressed={amount === String(preset)}
                className={`rounded-lg border px-2 py-2 text-xs font-black tabular-nums transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 ${amount === String(preset) ? 'border-amber-500 bg-gradient-to-b from-amber-300 to-orange-400 text-[#3b210c] shadow-inner' : 'border-white/15 bg-white/10 text-amber-100 hover:border-amber-300/60'}`}
              >
                {preset.toLocaleString()}
              </button>
            ))}
          </div>
          <button
            disabled={loading || !isVerified || ownEntry || isRoundClosed || Number(amount) < MIN_ARENA_ENTRY || Number(amount) > availableBalance}
            onClick={() => void join()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg game-cta bg-gradient-to-b from-[#ffe08a] to-[#f59e0b] py-3 font-black text-[#3b2106] shadow-[0_3px_0_#a35c05] disabled:opacity-40"
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}
            {t(lang, 'arenaJoin')} · {Number(amount || 0).toLocaleString()}
          </button>
          {canCancelWaitingEntry && (
            <button type="button" onClick={() => void cancelWaitingEntry()} disabled={loading} className="mt-2 w-full rounded-lg border border-rose-300/40 bg-rose-400/10 py-2.5 text-xs font-black text-rose-200 disabled:opacity-50">
              {loading ? <Loader2 className="mx-auto animate-spin" size={15} /> : t(lang, 'arenaCancelEntry')}
            </button>
          )}
          <p className="mt-2 text-[10px] text-white/45">{t(lang, 'arenaMin')} · {t(lang, 'arenaRules')} · {t(lang, 'arenaMaxHint')}</p>
          <p className="mt-2 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-[10px] leading-relaxed text-emerald-100">{t(lang, 'arenaWinFeeNote')}</p>
          <p className="mt-2 rounded-lg border border-blue-400/15 bg-blue-400/[.06] px-3 py-2 text-[10px] leading-relaxed text-blue-100/75">{t(lang, 'arenaWaitingNoExpiry')}</p>
        </section>

        <section className="game-panel p-3 text-amber-50 shadow-[0_10px_26px_rgba(0,0,0,.4)]">
          <h3 className="mb-2 text-sm font-black">{t(lang, 'arenaPlayers')}</h3>
          {displayedEntries.length === 0 ? (
            <div className="py-4 text-center text-xs text-white/45">{t(lang, 'arenaNoRound')}</div>
          ) : displayedEntries.map((entry, entryIndex) => (
            <div key={entry.telegramId} style={{ animationDelay: Math.min(entryIndex, 8) * 0.04 + 's' }} className={"row-in flex items-center justify-between border-b border-white/10 py-2 last:border-0 " + (entry.telegramId === telegramUserId ? "rounded-lg bg-amber-300/10 px-2" : "")}>
              <div className="flex min-w-0 items-center gap-2">
                {entry.photoUrl ? (
                  <img src={entry.photoUrl} alt={entry.username} referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-full border border-white/20 object-cover" />
                ) : (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet-500/20 text-xs font-black text-violet-200">{entry.username.slice(0, 1).toUpperCase()}</span>
                )}
                <span className="truncate text-xs font-bold">
                  {entry.username}{entry.telegramId === telegramUserId ? ' · ' + t(lang, 'arenaYou') : ''}
                </span>
              </div>
              <div className="text-end">
                <b className="text-xs font-black text-amber-300">{entry.amount.toLocaleString()}</b>
                <div className="text-[9px] font-semibold text-white/50">{(75 * entry.amount / Math.max(total, 1)).toFixed(1)}%</div>
              </div>
            </div>
          ))}
        </section>

        <section className="mt-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-black text-amber-50">{t(lang, 'arenaBetHistory')}</h3>
            <span className="text-[10px] font-bold text-white/45">{history.length}</span>
          </div>
          {history.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center text-xs text-white/45">{t(lang, 'arenaHistoryEmpty')}</div>
          ) : history.map((item, index) => (
            <article key={item.id} className="overflow-hidden rounded-xl border border-white/10 bg-white/[.06] p-3 text-amber-50">
              <div className="mb-2 flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                <div className="text-xs font-black">{t(lang, 'arenaHistoryRound')} #{history.length - index}</div>
                <time className="text-[9px] font-semibold text-white/50" dateTime={item.occurredAt}>
                  {new Date(item.occurredAt).toLocaleString(lang === 'ar' ? 'ar-EG' : lang === 'ru' ? 'ru-RU' : 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </time>
              </div>
              <div className="mb-2 flex items-center justify-between text-[10px] text-white/50">
                <span>{t(lang, 'arenaHistoryPot')}: <b className="text-amber-300">{item.total.toLocaleString()}</b></span>
                <span>{item.entries.length} {t(lang, 'arenaPlayers')}</span>
              </div>
              <div className="mb-2 flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-2 text-[9px] text-white/50">
                <span>{t(lang, 'arenaHistoryFee')}: <b className="text-rose-300">{item.fee.toLocaleString()}</b></span>
                <span>{t(lang, 'arenaHistoryNetWin')}: <b className="text-emerald-300">{item.netWinnings.toLocaleString()}</b></span>
              </div>
              <div className="space-y-2">
                {item.entries.map((entry) => (
                  <div key={entry.telegramId} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[.05] px-2.5 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-extrabold">{entry.username}{entry.telegramId === telegramUserId ? ' · ' + t(lang, 'arenaYou') : ''}</div>
                      <div className="mt-0.5 text-[9px] text-white/50">{t(lang, 'arenaHistoryStake')}: {entry.stake.toLocaleString()}</div>
                    </div>
                    <div className="shrink-0 text-end">
                      {entry.outcome === 'win' ? (
                        <>
                          <div className="text-xs font-black text-emerald-300">+{entry.amount.toLocaleString()}</div>
                          <div className="text-[9px] font-bold text-emerald-300">{t(lang, 'arenaHistoryWon')} · {entry.multiplier.toFixed(2)}X</div>
                          <div className="text-[9px] text-emerald-100/60">{t(lang, 'arenaHistoryStakeReturned')}: {entry.stake.toLocaleString()}</div>
                        </>
                      ) : entry.outcome === 'refund' ? (
                        <>
                          <div className="text-xs font-black text-amber-300">+{entry.amount.toLocaleString()}</div>
                          <div className="text-[9px] font-bold text-amber-300">{t(lang, 'arenaHistoryRefund')}</div>
                        </>
                      ) : (
                        <>
                          <div className="text-xs font-black text-rose-300">-{entry.amount.toLocaleString()}</div>
                          <div className="text-[9px] font-bold text-rose-300">{t(lang, 'arenaHistoryLost')} · 1.00X</div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>

        {state.lastResult && (replaying || !round) && (
          <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm font-bold">
            <div className="mb-1 text-[10px] uppercase text-amber-200/70">{replaying ? t(lang, 'arenaReplayWinner') : t(lang, 'arenaWinner')}</div>
            {state.lastResult.winnerType === 'house'
              ? t(lang, 'arenaReplayHouse')
              : state.lastResult.winnerTelegramId === telegramUserId
                ? t(lang, 'arenaPlayerWon')
                : `${t(lang, 'arenaReplayPlayer')}: ${state.lastResult.entries.find((entry) => entry.telegramId === state.lastResult?.winnerTelegramId)?.username ?? t(lang, 'arenaRoundClosed')}`}
            <div className="mt-1 text-[10px] font-semibold text-amber-200/70">{state.lastResult.totalEntries.toLocaleString()}</div>
          </div>
        )}

          </div>
        </div>
      </div>
    </div>
  );
}
