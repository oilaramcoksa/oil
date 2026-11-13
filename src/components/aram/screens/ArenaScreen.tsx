'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, History, Loader2, Users, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useGame } from '@/lib/store';
import { t } from '@/lib/i18n';

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
type ArenaState = {
  round: Round | null;
  balance: number;
  entries: Entry[];
  lastResult: LastResult | null;
};

const EMPTY_STATE: ArenaState = { round: null, balance: 0, entries: [], lastResult: null };

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
  const [amount, setAmount] = useState('1000');
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const headers = useMemo(() => ({ 'X-Telegram-Init-Data': initData }), [initData]);

  const refresh = useCallback(async () => {
    if (!isVerified || !initData) return;
    const response = await fetch('/api/arena', { headers, cache: 'no-store' });
    if (!response.ok) throw new Error('arena_state_failed');
    const data = await response.json() as ArenaState;
    setState(data);
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
    const timer = window.setInterval(() => void poll(), 1_000);
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
  const displayedEntries = round ? activeEntries : (state.lastResult?.entries ?? []);
  const total = displayedEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const balance = state.balance;
  const ownEntry = activeEntries.some((entry) => entry.telegramId === telegramUserId);
  const countdown = round?.startsAt
    ? Math.max(0, Math.ceil((round.startsAt - now) / 1000))
    : null;
  const isSpinning = round?.status === 'spinning';
  const displayStop = round
    ? (round.wheelStopDegrees ?? 0)
    : (state.lastResult?.wheelStopDegrees ?? 0);
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
    if (!Number.isSafeInteger(entryAmount) || entryAmount < 1_000) {
      toast.error(t(lang, 'arenaMin'));
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/arena', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: entryAmount }),
      });
      const data = await response.json() as { balance?: number; error?: string };
      if (!response.ok) {
        const errorKey = data.error === 'insufficient_balance'
          ? 'arenaInsufficient'
          : data.error === 'already_joined'
            ? 'arenaJoinedAlready'
            : data.error === 'round_starting'
              ? 'arenaRoundStarted'
              : data.error === 'minimum_1000_required'
                ? 'arenaMin'
                : 'arenaError';
        toast.error(t(lang, errorKey));
        return;
      }
      setAmount('1000');
      await refresh();
      toast.success(t(lang, 'arenaJoined'));
    } catch (error) {
      console.error('arena_join_ui_failed', error);
      toast.error(t(lang, 'arenaError'));
    } finally {
      setLoading(false);
    }
  };

  const isRoundClosed = Boolean(round && (round.status === 'spinning' || (round.startsAt !== null && round.startsAt <= now)));
  const spinRemaining = round?.spinStartedAt
    ? Math.max(0.2, (round.spinStartedAt + 7_000 - now) / 1_000)
    : 7;

  return (
    <div className="h-full overflow-y-auto bg-[#171719] px-3 pt-4 pb-6 text-white" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="mx-auto w-full max-w-md">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black tracking-tight">{t(lang, 'arenaTitle')}</h2>
            <p className="mt-1 text-xs text-zinc-400">{t(lang, 'arenaSubtitle')}</p>
          </div>
          <button
            onClick={() => void refresh()}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5"
            aria-label={t(lang, 'arenaRecent')}
          >
            <History size={18} />
          </button>
        </header>

        <section className="mb-4 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#252735] via-[#1d202b] to-[#17191f] p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500/15 text-blue-300"><Users size={18}/></span>
              <div><div className="text-sm font-extrabold">{t(lang, 'arenaRoundLabel')}</div><div className="mt-0.5 text-[10px] text-zinc-400">{t(lang, 'arenaPlayers')}: {displayedEntries.length}</div></div>
            </div>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold text-emerald-300">{round?.status === 'countdown' ? t(lang, 'arenaCountdown') : isSpinning ? t(lang, 'arenaSpinning') : t(lang, 'arenaReady')}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-black/20 p-2.5"><div className="text-[10px] text-zinc-400">{t(lang, 'arenaPot')}</div><div className="mt-1 text-lg font-black tabular-nums text-amber-300">{total.toLocaleString()}</div></div>
            <div className="rounded-xl bg-black/20 p-2.5"><div className="text-[10px] text-zinc-400">{t(lang, 'arenaBalance')}</div><div className="mt-1 text-lg font-black tabular-nums text-emerald-300">{balance.toLocaleString()}</div></div>
          </div>
        </section>

        <div className="relative mx-auto my-5 aspect-square w-[min(82vw,370px)]">
          <div className="absolute -top-2 left-1/2 z-20 -translate-x-1/2 drop-shadow-[0_3px_8px_rgba(0,0,0,.7)]"><div className="h-0 w-0 border-x-[16px] border-t-[27px] border-x-transparent border-t-white"/></div>
          <motion.div
            initial={false}
            animate={{ rotate: isSpinning ? 2_880 + displayStop : !round && state.lastResult ? 2_880 + displayStop : displayStop }}
            transition={isSpinning ? { duration: spinRemaining, ease: [0.12, 0.75, 0.12, 1] } : { duration: 0.35 }}
            className="absolute inset-0 rounded-full border-[8px] border-[#2c2f3a] shadow-[inset_0_0_0_2px_rgba(255,255,255,.22),0_0_0_3px_rgba(0,0,0,.55),0_24px_55px_rgba(0,0,0,.65)]"
            style={{ background: wheelGradient }}
          >
            {wheelEntries.map((entry, index) => {
              const angle = wheelEntries.slice(0, index).reduce((sum, item) => sum + item.weight, 0) + entry.weight / 2 - 90;
              return (
                <div
                  key={entry.id}
                  className="absolute left-1/2 top-1/2 z-[2] grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center"
                  style={{ transform: `rotate(${angle}deg) translateY(-112px) rotate(-${angle}deg)` }}
                  title={entry.house ? entry.label : `${entry.label} · ${entry.weight.toFixed(1)}%`}
                >
                  {entry.house ? (
                    <span className="grid h-10 w-10 place-items-center rounded-full border-[3px] border-white bg-amber-300 text-xl text-amber-950 shadow-[0_3px_12px_rgba(0,0,0,.5)]">🔥</span>
                  ) : entry.photoUrl ? (
                    <img src={entry.photoUrl} alt={entry.label} referrerPolicy="no-referrer" className="h-11 w-11 rounded-full border-[3px] border-white object-cover shadow-[0_3px_12px_rgba(0,0,0,.55)]" />
                  ) : (
                    <span className="grid h-11 w-11 place-items-center rounded-full border-[3px] border-white bg-[#17191f] text-sm font-black text-white shadow-[0_3px_12px_rgba(0,0,0,.55)]">{entry.label.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
              );
            })}
          </motion.div>

          <div className="absolute inset-[34%] z-10 flex flex-col items-center justify-center rounded-full border-[5px] border-white/90 bg-[radial-gradient(circle_at_35%_25%,#343746,#15171d_72%)] shadow-[0_0_0_7px_rgba(0,0,0,.22),0_8px_30px_rgba(0,0,0,.7)]">
            <div className="mb-1 grid h-8 w-8 place-items-center rounded-full bg-white/10 text-amber-300">{isSpinning ? <Zap size={17}/> : <Users size={17}/>}</div>
            <div className="text-center text-xl font-black tabular-nums">
              {round?.status === 'countdown'
                ? `00:${String(countdown ?? 0).padStart(2, '0')}`
                : isSpinning
                  ? t(lang, 'arenaSpinning')
                  : t(lang, 'arenaReady')}
            </div>
            <div className="mt-1 text-[9px] text-zinc-400">{displayedEntries.length} · {t(lang, 'arenaPlayers')}</div>
          </div>
        </div>

        <section className="mb-3 rounded-xl border border-white/10 bg-white/[.04] p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
            <span className="flex items-center gap-1"><Coins size={13} /> {t(lang, 'arenaPot')}</span>
            <strong className="text-base text-amber-400">{total.toLocaleString()}</strong>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/4 bg-gradient-to-r from-amber-300 via-orange-400 to-amber-500" />
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-zinc-400">
            <span>{t(lang, 'arenaBurnSlice')}</span><span>25%</span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">{t(lang, 'arenaAdminNote')}</p>
        </section>

        <section className="mb-3 rounded-xl border border-white/10 bg-white/[.04] p-3">
          <div className="mb-2 flex justify-between text-xs text-zinc-400">
            <span>{t(lang, 'arenaAmount')}</span><span>{t(lang, 'arenaBalance')}: <b className="text-amber-400">{balance.toLocaleString()}</b></span>
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              min="1000"
              max={balance}
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={ownEntry || isRoundClosed}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#25262a] p-3 font-black outline-none focus:border-blue-500"
            />
            <button
              onClick={() => void join(balance)}
              disabled={loading || !isVerified || ownEntry || isRoundClosed || balance < 1000}
              className="rounded-xl border border-amber-300/20 bg-gradient-to-b from-amber-400/20 to-orange-500/10 px-4 text-xs font-black text-amber-200 shadow-inner disabled:opacity-40"
            >
              {t(lang, 'arenaMax')}
            </button>
          </div>
          <button
            disabled={loading || !isVerified || ownEntry || isRoundClosed || Number(amount) < 1_000 || Number(amount) > balance}
            onClick={() => void join()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#ff9f50] py-3 font-black text-[#24180f] disabled:opacity-40"
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}
            {t(lang, 'arenaJoin')} · {Number(amount || 0).toLocaleString()}
          </button>
          <p className="mt-2 text-[10px] text-zinc-500">{t(lang, 'arenaMin')} · {t(lang, 'arenaRules')} · {t(lang, 'arenaMaxHint')}</p>
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[.04] p-3">
          <h3 className="mb-2 text-sm font-black">{t(lang, 'arenaPlayers')}</h3>
          {displayedEntries.length === 0 ? (
            <div className="py-4 text-center text-xs text-zinc-500">{t(lang, 'arenaNoRound')}</div>
          ) : displayedEntries.map((entry) => (
            <div key={entry.telegramId} className="flex items-center justify-between border-b border-white/5 py-2 last:border-0">
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
                <b className="text-xs text-amber-400">{entry.amount.toLocaleString()}</b>
                <div className="text-[9px] text-zinc-500">{(75 * entry.amount / Math.max(total, 1)).toFixed(1)}%</div>
              </div>
            </div>
          ))}
        </section>

        {!round && state.lastResult && (
          <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm font-bold">
            <div className="mb-1 text-[10px] uppercase text-amber-200/70">{t(lang, 'arenaWinner')}</div>
            {state.lastResult.winnerType === 'house'
              ? t(lang, 'arenaAdminWon')
              : state.lastResult.winnerTelegramId === telegramUserId
                ? t(lang, 'arenaPlayerWon')
                : `${t(lang, 'arenaRoundClosed')} · ${state.lastResult.totalEntries.toLocaleString()}`}
          </div>
        )}
      </div>
    </div>
  );
}
