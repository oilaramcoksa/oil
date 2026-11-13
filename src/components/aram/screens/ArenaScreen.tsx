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
    <div className="h-full overflow-y-auto bg-transparent px-3 pt-4 pb-6 text-[#542b12]" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="mx-auto w-full max-w-md">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black tracking-tight">{t(lang, 'arenaTitle')}</h2>
            <p className="mt-1 text-xs text-[#8f6b4d]">{t(lang, 'arenaSubtitle')}</p>
          </div>
          <button
            onClick={() => void refresh()}
            className="grid h-10 w-10 place-items-center rounded-xl border border-amber-700/15 bg-white/55 text-amber-900 shadow-sm"
            aria-label={t(lang, 'arenaRecent')}
          >
            <History size={18} />
          </button>
        </header>

        <section className="mb-4 overflow-hidden rounded-2xl border border-white/75 bg-white/75 p-3 text-[#633715] shadow-[0_8px_24px_rgba(120,53,15,.12)] backdrop-blur-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-100 text-amber-700"><Users size={18}/></span>
              <div><div className="text-sm font-extrabold">{t(lang, 'arenaRoundLabel')}</div><div className="mt-0.5 text-[10px] text-[#9a7659]">{t(lang, 'arenaPlayers')}: {displayedEntries.length}</div></div>
            </div>
            <span className="rounded-full border border-emerald-700/15 bg-emerald-100 px-3 py-1 text-[10px] font-bold text-emerald-800">{round?.status === 'countdown' ? t(lang, 'arenaCountdown') : isSpinning ? t(lang, 'arenaSpinning') : t(lang, 'arenaReady')}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-amber-900/5 bg-[#fff7e9]/85 p-2.5"><div className="text-[10px] text-[#987354]">{t(lang, 'arenaPot')}</div><div className="mt-1 text-lg font-black tabular-nums text-amber-800">{total.toLocaleString()}</div></div>
            <div className="rounded-xl border border-amber-900/5 bg-[#fff7e9]/85 p-2.5"><div className="text-[10px] text-[#987354]">{t(lang, 'arenaBalance')}</div><div className="mt-1 text-lg font-black tabular-nums text-emerald-800">{balance.toLocaleString()}</div></div>
          </div>
        </section>

        <div className="relative mx-auto my-7 aspect-square w-[min(84vw,390px)] [perspective:1000px]">
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
            initial={false}
            animate={{ rotate: isSpinning ? 2_880 + displayStop : !round && state.lastResult ? 2_880 + displayStop : displayStop }}
            transition={isSpinning ? { duration: spinRemaining, ease: [0.08, 0.72, 0.12, 1] } : { duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute inset-[11px] overflow-hidden rounded-full border-[3px] border-[#f8dba5]/90 shadow-[inset_0_0_18px_rgba(107,57,15,.18),0_4px_12px_rgba(120,53,15,.2)]"
            style={{ background: wheelGradient, transformStyle: 'preserve-3d', backfaceVisibility: 'hidden' }}
          >
            {/* Radial depth, glass reflection and engraved segment separators */}
            <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(ellipse_at_32%_18%,rgba(255,255,255,.42),transparent_36%),radial-gradient(ellipse_at_50%_50%,transparent_48%,rgba(110,55,10,.18)_100%)]" />
            <div className="pointer-events-none absolute inset-[3px] rounded-full border border-white/25 shadow-[inset_0_2px_8px_rgba(255,255,255,.22),inset_0_-12px_22px_rgba(0,0,0,.22)]" />
            {wheelEntries.map((entry, index) => {
              const angle = entry.house
                ? -135
                : -90 + ((25 + (displayedEntries.slice(0, index - 1).reduce((sum, item) => sum + item.amount, 0) + (displayedEntries[index - 1]?.amount ?? 0) / 2) / Math.max(total, 1)) * 270);
              return (
                <div
                  key={entry.id}
                  className="absolute z-[5] grid place-items-center"
                  style={{ left: `${50 + Math.cos(angle * Math.PI / 180) * 37}%`, top: `${50 + Math.sin(angle * Math.PI / 180) * 37}%`, width: avatarSize, height: avatarSize, transform: 'translate(-50%, -50%)' }}
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
            <div className="mb-1 grid h-7 w-7 place-items-center rounded-full border border-amber-700/20 bg-amber-100 text-amber-800">
              {isSpinning ? <Zap size={15}/> : <Users size={15}/>}
            </div>
            <div className="text-center text-lg font-black tabular-nums leading-none">
              {round?.status === 'countdown'
                ? `00:${String(countdown ?? 0).padStart(2, '0')}`
                : isSpinning
                  ? t(lang, 'arenaSpinning')
                  : t(lang, 'arenaReady')}
            </div>
            <div className="mt-2 flex items-center justify-center gap-1 text-[11px] font-bold leading-none text-[#8b613d]">
              <span>{displayedEntries.length}</span>
              <Users size={12} className="shrink-0 text-amber-300" />
            </div>
          </div>
        </div>

        <section className="mb-3 rounded-xl border border-white/75 bg-white/75 p-3 text-[#633715] shadow-[0_8px_24px_rgba(120,53,15,.1)] backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between text-xs text-[#8f6b4d]">
            <span className="flex items-center gap-1"><Coins size={13} /> {t(lang, 'arenaPot')}</span>
            <strong className="text-base font-black text-amber-800">{total.toLocaleString()}</strong>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-amber-900/10">
            <div className="h-full w-1/4 bg-gradient-to-r from-amber-300 via-orange-400 to-amber-500" />
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-[#8f6b4d]">
            <span>{t(lang, 'arenaBurnSlice')}</span><span>25%</span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-[#8f6b4d]">{t(lang, 'arenaAdminNote')}</p>
        </section>

        <section className="mb-3 rounded-xl border border-white/75 bg-white/75 p-3 text-[#633715] shadow-[0_8px_24px_rgba(120,53,15,.1)] backdrop-blur-md">
          <div className="mb-2 flex justify-between text-xs text-[#8f6b4d]">
            <span>{t(lang, 'arenaAmount')}</span><span>{t(lang, 'arenaBalance')}: <b className="font-black text-amber-800">{balance.toLocaleString()}</b></span>
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
              className="min-w-0 flex-1 rounded-lg border border-[#6b3b19] bg-[#25262a] p-3 font-black text-white caret-white outline-none placeholder:text-white/50 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30"
            />
            <button
              onClick={() => void join(balance)}
              disabled={loading || !isVerified || ownEntry || isRoundClosed || balance < 1000}
              className="rounded-xl border border-amber-600 bg-gradient-to-b from-amber-400 to-orange-500 px-4 text-xs font-black text-[#3b210c] shadow-md disabled:opacity-40"
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
          <p className="mt-2 text-[10px] text-[#9a7659]">{t(lang, 'arenaMin')} · {t(lang, 'arenaRules')} · {t(lang, 'arenaMaxHint')}</p>
          <p className="mt-2 rounded-lg border border-blue-400/15 bg-blue-400/[.06] px-3 py-2 text-[10px] leading-relaxed text-blue-100/75">{t(lang, 'arenaTimeoutRefund')}</p>
        </section>

        <section className="rounded-xl border border-white/75 bg-white/75 p-3 text-[#633715] shadow-[0_8px_24px_rgba(120,53,15,.1)] backdrop-blur-md">
          <h3 className="mb-2 text-sm font-black">{t(lang, 'arenaPlayers')}</h3>
          {displayedEntries.length === 0 ? (
            <div className="py-4 text-center text-xs text-[#9a7659]">{t(lang, 'arenaNoRound')}</div>
          ) : displayedEntries.map((entry) => (
            <div key={entry.telegramId} className="flex items-center justify-between border-b border-amber-900/10 py-2 last:border-0">
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
                <b className="text-xs font-black text-amber-800">{entry.amount.toLocaleString()}</b>
                <div className="text-[9px] font-semibold text-[#805b3c]">{(75 * entry.amount / Math.max(total, 1)).toFixed(1)}%</div>
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
