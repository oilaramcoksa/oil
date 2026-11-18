'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2, VolumeX, Loader2, Users, Clock3, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { useGame } from '@/lib/store';
import { t } from '@/lib/i18n';

type CrashBet = {
  telegramId: string; username: string; amount: number; status: 'active' | 'cashed_out' | 'lost';
  cashoutMultiplier: number | null; payout: number; photoUrl: string | null;
};
type CrashRound = {
  id: string; status: 'countdown' | 'running' | 'crashed'; bettingEndsAt: number;
  startedAt: number | null; crashedAt: number | null; currentMultiplier: number;
  crashMultiplier: number | null; seedHash: string; revealedSeed: string | null;
};
type PlaneRecommendation = { advice: 'no_entry' | 'high_risk' | 'potential_entry'; remaining: number; sampleSize: number; instantCount: number; earlyCount: number; roundId: string };
type CrashState = {
  round: CrashRound; bets: CrashBet[]; balance: number; betBalance: number;
  previousRound: { id: string; crashMultiplier: number; crashedAt: number; seedHash: string; revealedSeed: string; bets: Omit<CrashBet,'photoUrl'>[] } | null;
  serverTime: number;
};
const EMPTY: CrashState | null = null;
const fmt = (n: number) => Math.max(0, Math.floor(n)).toLocaleString('en-US');

export function CrashGameScreen({ initData, isVerified, telegramUserId, onBuyTokens, buyingTokens }: { initData: string; isVerified: boolean; telegramUserId: string; onBuyTokens: () => void; buyingTokens: boolean }) {
  const lang = useGame((s) => s.lang);
  const soundEnabled = useGame((s) => s.sound);
  const [state, setState] = useState<CrashState | null>(EMPTY);
  const [amount, setAmount] = useState('100');
  const [loading, setLoading] = useState(false);
  const [tipLoading, setTipLoading] = useState(false);
  const [tipRemaining, setTipRemaining] = useState(0);
  const [tipResult, setTipResult] = useState<PlaneRecommendation | null>(null);
  const [now, setNow] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [sound, setSound] = useState(soundEnabled);
  const [showExplosion, setShowExplosion] = useState(false);
  const [parachuteEvents, setParachuteEvents] = useState<Array<{id:string;username:string}>>([]);
  const seenCashouts = useRef<Set<string>>(new Set());
  const playedExplosionFor = useRef<string | null>(null);
  const headers = useMemo(() => ({ 'X-Telegram-Init-Data': initData }), [initData]);

  const refresh = useCallback(async () => {
    if (!isVerified || !initData) return;
    const requestStartedAt = Date.now();
    const response = await fetch('/api/crash', { headers, cache: 'no-store' });
    if (!response.ok) throw new Error('crash_state_failed');
    const data = await response.json() as CrashState;
    setState(data);
    setServerOffset(data.serverTime - (requestStartedAt + Date.now()) / 2);
  }, [headers, initData, isVerified]);

  useEffect(() => {
    if (!isVerified || !initData) return;
    let alive = true;
    void fetch('/api/crash/recommendation', { headers: { 'X-Telegram-Init-Data': initData }, cache: 'no-store' })
      .then(async (response) => { if (!response.ok) return; const data = await response.json(); if (alive) setTipRemaining(Number(data.remaining ?? 0)); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [initData, isVerified]);

  useEffect(() => {
    if (!isVerified) return;
    let alive = true;
    const poll = async () => { try { if (alive) await refresh(); } catch (e) { console.error('crash_refresh_failed', e); } };
    void poll();
    const timer = window.setInterval(() => void poll(), 750);
    return () => { alive = false; window.clearInterval(timer); };
  }, [isVerified, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, []);

  const round = state?.round;
  const serverNow = now + serverOffset;
  const secondsLeft = round?.status === 'countdown' ? Math.max(0, Math.ceil((round.bettingEndsAt - serverNow) / 1000)) : 0;
  const liveMultiplier = round?.status === 'running' && round.startedAt
    ? Math.min(20, Math.floor((1 + Math.max(0, serverNow - round.startedAt) / 10_000) * 10) / 10)
    : round?.status === 'crashed' ? (round.crashMultiplier ?? 1) : 1;
  const recentCrash = Boolean(state?.previousRound?.crashedAt && serverNow - state.previousRound.crashedAt < 3_500);
  const ownBet = state?.bets.find((bet) => bet.telegramId === telegramUserId);
  const previousOwnBet = state?.previousRound?.bets.find((bet) => bet.telegramId === telegramUserId);
  useEffect(() => {
    if (!state) return;
    const observed = [
      ...state.bets.map((bet) => ({ roundId: state.round.id, ...bet })),
      ...(state.previousRound?.bets ?? []).map((bet) => ({ roundId: state.previousRound!.id, ...bet })),
    ];
    const fresh = observed.filter((bet) => bet.status === 'cashed_out' && !seenCashouts.current.has(`${bet.roundId}:${bet.telegramId}`));
    if (!fresh.length) return;
    const events = fresh.map((bet) => {
      const id = `${bet.roundId}:${bet.telegramId}`;
      seenCashouts.current.add(id);
      return { id, username: bet.username };
    });
    setParachuteEvents((current) => [...current, ...events].slice(-10));
    const timer = window.setTimeout(() => setParachuteEvents((current) => current.filter((event) => !events.some((item) => item.id === event.id))), 4300);
    return () => window.clearTimeout(timer);
  }, [state]);
  const maxSingleWallet = Math.max(state?.balance ?? 0, state?.betBalance ?? 0);
  const canBet = Boolean(round?.status === 'countdown' && !ownBet && !loading && isVerified);
  const canCashout = Boolean(round?.status === 'running' && ownBet?.status === 'active' && !loading);

  const playTone = (frequency: number, duration = 0.12) => {
    if (!sound) return;
    try {
      const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.07, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + duration);
      oscillator.onended = () => void context.close();
    } catch { /* Sound is optional; gameplay never depends on it. */ }
  };

  const act = async (action: 'bet' | 'cashout') => {
    if (loading) return;
    if (action === 'bet') {
      const value = Number(amount);
      if (!Number.isSafeInteger(value) || value < 100 || (value > (state?.betBalance ?? 0) && value > (state?.balance ?? 0))) {
        toast.error(lang === 'ar' ? 'المبلغ غير صالح أو لا يوجد رصيد كافٍ في محفظة واحدة' : lang === 'ru' ? 'Неверная сумма или недостаточно средств на одном кошельке' : 'Invalid amount or insufficient balance in one wallet');
        return;
      }
    }
    setLoading(true);
    try {
      const response = await fetch('/api/crash', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(action === 'bet' ? { amount: Number(amount) } : {}) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messages: Record<string,string> = {
          betting_closed: lang === 'ar' ? 'أُغلق باب المشاركة لهذه الجولة' : lang === 'ru' ? 'Приём ставок на этот раунд завершён' : 'Betting is closed for this round',
          insufficient_balance: lang === 'ar' ? 'الرصيد غير كافٍ في محفظة واحدة' : lang === 'ru' ? 'Недостаточно средств на одном кошельке' : 'Insufficient balance in one wallet',
          already_joined: lang === 'ar' ? 'شاركت بالفعل في هذه الجولة' : lang === 'ru' ? 'Вы уже участвуете в этом раунде' : 'You already joined this round',
          round_crashed: lang === 'ar' ? 'انفجرت الطائرة قبل قبول السحب؛ خسرت الرهان' : lang === 'ru' ? 'Самолёт разбился до подтверждения вывода; ставка проиграна' : 'The plane crashed before cashout was accepted',
          bet_not_found: lang === 'ar' ? 'لم تشارك في هذه الجولة' : lang === 'ru' ? 'В этом раунде ваша ставка не найдена' : 'No bet found for this round',
        };
        throw new Error(messages[String(data.error)] ?? String(data.error ?? 'crash_action_failed'));
      }
      if (action === 'bet') { toast.success(lang === 'ar' ? 'تم تسجيل رهانك للجولة القادمة' : lang === 'ru' ? 'Ваша ставка принята' : 'Your bet is registered'); playTone(560); }
      else { toast.success((lang === 'ar' ? 'تم السحب عند ' : lang === 'ru' ? 'Вы вывели средства при ' : 'Cashed out at ') + Number(data.multiplier).toFixed(2) + 'x · +' + fmt(Number(data.payout))); playTone(880, 0.2); }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (lang === 'ru' ? 'Не удалось выполнить действие. Попробуйте ещё раз.' : 'crash_action_failed'));
      if (action === 'cashout') playTone(180, 0.25);
      await refresh().catch(() => undefined);
    } finally { setLoading(false); }
  };

  const usePlaneTip = async () => {
    if (tipLoading || tipRemaining < 1 || round?.status !== 'countdown') return;
    setTipLoading(true);
    setTipResult(null);
    try {
      const response = await fetch('/api/crash/recommendation', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.error === 'round_not_open') throw new Error(t(lang, 'planeTipsRoundClosed'));
        if (data.error === 'no_recommendations') throw new Error(t(lang, 'planeTipsNotOwned'));
        throw new Error(t(lang, 'planeTipsError'));
      }
      setTipResult(data as PlaneRecommendation);
      setTipRemaining(Number(data.remaining ?? 0));
      playTone(720, 0.12);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(lang, 'planeTipsError'));
    } finally { setTipLoading(false); }
  };

  const explosionKey = round?.status === 'crashed' ? round.id : state?.previousRound?.id ?? null;
  useEffect(() => {
    if (!explosionKey || playedExplosionFor.current === explosionKey) return;
    const hasCrashed = round?.status === 'crashed' || Boolean(state?.previousRound?.crashedAt);
    if (!hasCrashed) return;
    playedExplosionFor.current = explosionKey;
    setShowExplosion(false);
    const timer = window.setTimeout(() => {
      setShowExplosion(true);
      playTone(72, 0.62);
      window.setTimeout(() => setShowExplosion(false), 900);
    }, 35);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explosionKey, round?.status, state?.previousRound?.crashedAt]);

  return (
    <div className="mx-auto w-full max-w-md space-y-3 pb-8 text-[#f8e7c6]" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <section className="rounded-2xl border border-amber-300/20 bg-[#111a35] p-3 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div><div className="text-lg font-black">{lang === 'ar' ? 'ARMCOFLY · لعبة الطائرة' : lang === 'ru' ? 'ARMCOFLY · АВИАКРАШ' : 'ARMCOFLY · CRASH'}</div><div className="text-[10px] text-amber-100/60">{lang === 'ar' ? 'اسحب أرباحك قبل الانفجار' : lang === 'ru' ? 'Заберите выигрыш до крушения' : 'Cash out before the crash'}</div></div>
          <button onClick={() => setSound((v) => !v)} className="rounded-xl border border-white/15 bg-white/5 p-2" aria-label="Toggle sound">{sound ? <Volume2 size={18}/> : <VolumeX size={18}/>}</button>
        </div>
        <div className="relative h-72 overflow-hidden rounded-xl border border-sky-200/15 bg-[linear-gradient(180deg,#07152f_0%,#102d52_48%,#f28b4b_100%)] shadow-[inset_0_0_55px_rgba(4,12,32,.55)]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_72%_22%,rgba(255,220,145,.42),transparent_20%),radial-gradient(ellipse_at_50%_75%,rgba(249,115,22,.3),transparent_48%)]" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#f28b4b]/35 to-transparent" />
          <motion.div
            className="absolute inset-y-0 left-0 w-[200%]"
            animate={{ x: ['0%', '-50%'] }}
            transition={{ duration: 38, repeat: Infinity, ease: 'linear' }}
          >
            <svg viewBox="0 0 1200 290" preserveAspectRatio="none" className="h-full w-full">
              <g fill="#e8f4ff" opacity=".13">
                <path d="M35 92c8-22 40-25 53-7 19-14 48-2 49 21H24c-9-5-3-14 11-14zm410 70c10-25 43-29 59-8 18-16 49-4 51 20H423c-10-4-3-12 22-12zm490-92c11-27 47-30 63-7 20-17 53-4 54 22H912c-12-4-5-15 23-15z"/>
                <path d="M190 220c8-18 31-22 45-7 15-12 37-2 39 15H181c-7-3-3-8 9-8zm690-12c9-20 36-23 49-6 16-13 42-3 43 18H866c-8-4-3-12 14-12z"/>
              </g>
              <g fill="#fff" opacity=".24">
                <path d="M130 132c10-28 48-34 67-10 22-18 57-4 59 24H108c-11-5-5-14 22-14zm550 30c11-26 47-31 65-8 21-17 54-4 56 22H526c-10-5-4-14 22-14zm390-82c8-20 35-24 49-7 16-13 42-3 43 18h-103c-8-4-3-11 11-11z"/>
              </g>
              <g stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".18">
                <path d="M60 42h75M310 108h54M760 52h82M1040 190h64M210 270h42"/>
              </g>
            </svg>
          </motion.div>
          <motion.div
            className="absolute inset-y-0 left-0 w-[200%]"
            animate={{ x: ['0%', '-50%'] }}
            transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
          >
            <svg viewBox="0 0 1200 290" preserveAspectRatio="none" className="h-full w-full">
              <g fill="#fff" opacity=".42">
                <path d="M90 190c8-19 34-24 49-8 16-13 42-3 44 17H79c-8-3-4-9 11-9zm360-96c9-22 39-26 54-8 18-15 46-4 48 19H438c-9-4-4-11 12-11zm420 145c8-18 32-22 46-7 15-12 38-2 40 16H860c-7-3-3-9 10-9z"/>
              </g>
            </svg>
          </motion.div>
          <div className="absolute inset-0 opacity-20" style={{backgroundImage:'radial-gradient(#fff 0.7px,transparent 0.7px)',backgroundSize:'34px 34px'}} />
          <motion.svg viewBox="0 0 1200 290" className="pointer-events-none absolute inset-0 z-[6] h-full w-full" animate={{ x: ['-1%', '1%', '-1%'], y: [0, -2, 0] }} transition={{ duration: 23, repeat: Infinity, ease: 'easeInOut' }} aria-hidden="true">
            <g fill="none" stroke="#172b45" strokeWidth="2.1" strokeLinecap="round" opacity=".36"><path d="M145 70q8-7 16 0q8-7 16 0M190 88q6-5 12 0q6-5 12 0M735 58q8-7 16 0q8-7 16 0M790 82q6-5 12 0q6-5 12 0"/></g>
            <g fill="none" stroke="#f7faff" strokeWidth="1.7" strokeLinecap="round" opacity=".45"><path d="M475 116q7-6 14 0q7-6 14 0M510 132q5-4 10 0q5-4 10 0M1010 106q7-6 14 0q7-6 14 0"/></g>
          </motion.svg>

          {round?.status === 'running' && (
            <div className="pointer-events-none absolute left-[15%] top-[43%] z-10 h-16 w-[19%] -translate-y-1/2">
              <motion.div
                className="absolute left-0 top-1/2 h-7 w-full -translate-y-1/2 rounded-full blur-lg"
                style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,75,0,.12) 18%, rgba(255,119,0,.82) 58%, rgba(255,220,90,.95) 88%, transparent 100%)', transformOrigin: 'right center' }}
                animate={{ scaleX: [0.72, 1.08, 0.86], scaleY: [0.7, 1.15, 0.82], opacity: [.55, 1, .68] }}
                transition={{ duration: .42, repeat: Infinity, ease: 'easeInOut' }}
              />
              <motion.div
                className="absolute left-[5%] top-1/2 h-3 w-[90%] -translate-y-1/2 rounded-full blur-md"
                style={{ background: 'linear-gradient(90deg, transparent, #f97316 35%, #facc15 78%, #fff2a8)' }}
                animate={{ scaleX: [.75, 1, .82], skewX: [-8, 5, -4], opacity: [.65, 1, .72] }}
                transition={{ duration: .28, repeat: Infinity, ease: 'easeInOut' }}
              />
              {Array.from({ length: 5 }, (_, i) => (
                <motion.i
                  key={i}
                  className="absolute top-1/2 h-1.5 w-2 rounded-full bg-orange-300 shadow-[0_0_14px_5px_rgba(249,115,22,.8)]"
                  style={{ left: `${5 + i * 17}%`, filter: 'blur(2px)' }}
                  animate={{ x: [-2, -16 - (i % 3) * 5], y: [0, (i % 2 ? -1 : 1) * (4 + i)], opacity: [1, .15, 0], scale: [1, .7, .1] }}
                  transition={{ duration: .42 + (i % 3) * .12, repeat: Infinity, delay: i * .055, ease: 'easeOut' }}
                />
              ))}
            </div>
          )}
          <motion.div
            className="absolute left-1/2 top-[36%] z-20 w-[42%] max-w-[190px] -translate-x-1/2 -translate-y-1/2"
            animate={recentCrash || round?.status === 'crashed'
              ? { y: [0, -8, 18], rotate: [0, 8, 22], scale: [1, 1.08, .72], opacity: [1, 1, 0] }
              : round?.status === 'running'
                ? { y: [0, -3, 0], rotate: [-2, -1, -2], scale: [1, 1.012, 1] }
                : { y: [0, -2, 0], rotate: -2, scale: 1, opacity: 1 }}
            transition={round?.status === 'running' ? { duration: .8, repeat: Infinity, ease: 'easeInOut' } : { duration: .75, ease: 'easeOut' }}
          >
            <img src="/fly.png" alt="ARMCOFLY aircraft" draggable={false} className="block h-auto w-full select-none object-contain drop-shadow-[0_14px_24px_rgba(0,0,0,.55)]" />
          </motion.div>
          {round?.status === 'running' && <motion.div className="absolute left-1/2 top-[46%] z-10 h-36 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-300/10 blur-2xl" animate={{ scale: [1, 1.15, 1], opacity: [.35, .65, .35] }} transition={{ duration: 1.4, repeat: Infinity }} />}
          {showExplosion && <motion.div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.05, times: [0, .18, 1] }}>
            <motion.img src="/flydawn.png" alt="" draggable={false} className="absolute left-1/2 top-[36%] w-[42%] max-w-[190px] -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-[0_0_32px_rgba(249,115,22,1)]" initial={{ scale: .9, opacity: 0, rotate: -2 }} animate={{ scale: [ .9, 1.08, 1.2 ], opacity: [ 0, 1, 0 ], rotate: [-2, 1, 5] }} transition={{ duration: .72, times: [0, .12, 1], ease: 'easeOut' }}/>
            <motion.div className="absolute left-1/2 top-[36%] h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-200/90 blur-md" initial={{ scale: .15 }} animate={{ scale: [0.15, 3.6, 5.2], opacity: [1, .85, 0] }} transition={{ duration: .85, ease: 'easeOut' }}/>
            {Array.from({length:14},(_,i)=><motion.i key={i} className="absolute left-1/2 top-[36%] h-2 w-2 rounded-full bg-gradient-to-br from-yellow-100 to-orange-500 shadow-[0_0_12px_rgba(251,146,60,.9)]" initial={{ x: 0, y: 0, scale: 1, opacity: 1 }} animate={{ x: Math.cos(i*Math.PI/7)*150, y: Math.sin(i*Math.PI/7)*105, scale: 0, opacity: 0 }} transition={{ duration: .85, ease: 'easeOut' }}/>)}
          </motion.div>}
          <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-live="polite">
            {parachuteEvents.map((event, index) => (
              <motion.div key={event.id} className="absolute left-[18%] top-[27%] flex flex-col items-center" initial={{ x: 0, y: 0, opacity: 0, scale: .7 }} animate={{ x: [0, 20 + index * 4, 42 + index * 5], y: [0, 78, 184], opacity: [0, 1, 1, 0], rotate: [0, -3, 3] }} transition={{ duration: 4, ease: 'easeOut', times: [0, .12, .82, 1] }}>
                <svg width="44" height="34" viewBox="0 0 44 34" aria-hidden="true"><path d="M2 18C3 4 13 1 22 1S41 4 42 18Q22 27 2 18Z" fill="#f5c451" stroke="#fff0bd" strokeWidth="1.5"/><path d="M2 18L18 29M42 18L26 29M22 22L22 30" fill="none" stroke="#f8e8c8" strokeWidth="1.4"/></svg>
                <span className="h-4 w-3 rounded-full bg-amber-100 shadow-sm"/>
                <span className="mt-1 max-w-20 truncate rounded bg-slate-950/60 px-1.5 py-0.5 text-[8px] font-bold text-white">{event.username}</span>
              </motion.div>
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-3 z-20 text-center">
            <div className={`text-5xl font-black tabular-nums tracking-tight ${round?.status === 'crashed' ? 'text-rose-400' : 'text-white'}`}>
              {recentCrash || round?.status === 'crashed' ? (round?.crashMultiplier !== null && round?.crashMultiplier !== undefined && round.crashMultiplier <= 1 ? (lang === 'ar' ? 'تعذّر الإقلاع!' : lang === 'ru' ? 'ЗАДЕРЖКА ВЫЛЕТА!' : 'WEATHER DELAY!') : (lang === 'ar' ? 'انفجار!' : lang === 'ru' ? 'КРУШЕНИЕ!' : 'CRASHED!')) : liveMultiplier.toFixed(2) + 'x'}
            </div>
            <div className="mt-1 text-[10px] font-bold text-amber-100/65">
              {round?.status === 'countdown' ? (lang === 'ar' ? 'تبدأ الجولة خلال' : lang === 'ru' ? 'Следующий вылет через' : 'Next flight in') + ' ' + secondsLeft + 's' : round?.status === 'running' ? (lang === 'ar' ? 'الطائرة في الجو' : lang === 'ru' ? 'Самолёт в полёте' : 'Plane is flying') : round?.crashMultiplier !== null && round?.crashMultiplier !== undefined && round.crashMultiplier <= 1 ? (lang === 'ar' ? 'انفجرت قبل الإقلاع بسبب سوء الأحوال الجوية' : lang === 'ru' ? 'Вылет отменён до взлёта из-за плохой погоды' : 'Flight cancelled before takeoff due to bad weather') : (lang === 'ar' ? 'انفجرت عند ' : lang === 'ru' ? 'Крушение при ' : 'Crashed at ') + (round?.crashMultiplier?.toFixed(2) ?? '—') + 'x'}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-[10px] text-amber-100/70">
          <span className="flex items-center gap-1"><Clock3 size={13}/> {round?.status === 'countdown' ? (lang === 'ar' ? 'إغلاق الرهان بعد' : lang === 'ru' ? 'Приём ставок завершится через' : 'Betting closes in') : round?.status === 'running' ? (lang === 'ar' ? 'جولة مباشرة' : lang === 'ru' ? 'Раунд идёт' : 'Live round') : (lang === 'ar' ? 'استراحة الجولة' : lang === 'ru' ? 'Перерыв между раундами' : 'Round break')}</span>
          <b className="text-amber-300">{round?.status === 'countdown' ? secondsLeft + 's' : round?.status === 'running' ? liveMultiplier.toFixed(2) + 'x' : (lang === 'ar' ? 'استراحة 50 ثانية' : lang === 'ru' ? 'Перерыв 50 сек.' : '50s break')}</b>
        </div>
      </section>

      <section className="rounded-2xl border border-fuchsia-300/40 bg-gradient-to-br from-[#24133d] via-[#17213f] to-[#102c4a] p-3 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <img src="/brain.png" alt={t(lang, 'planeTipsPart')} className="h-14 w-14 shrink-0 object-contain" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black">{t(lang, 'planeTipsPart')}</div>
            <div className="mt-1 text-[10px] text-white/70">{t(lang, 'planeTipsRemaining')}: {tipRemaining}</div>
          </div>
          <button type="button" onClick={() => void usePlaneTip()} disabled={tipLoading || tipRemaining < 1 || round?.status !== 'countdown'} className="min-h-11 rounded-xl bg-gradient-to-r from-fuchsia-500 to-violet-600 px-3 py-2 text-xs font-black shadow-md disabled:opacity-40">
            {tipLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin"/> : t(lang, 'planeTipsUse')}
          </button>
        </div>
        <button type="button" onClick={() => window.dispatchEvent(new Event('open-plane-tips-store'))} className="mt-2 min-h-10 w-full rounded-xl border border-amber-300/40 bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-2 text-xs font-black text-[#3c210c] shadow-md transition active:scale-[.98]">
          {t(lang, 'planeTipsBuy')}
        </button>
        {tipResult && (
          <div className={`mt-3 rounded-xl border p-3 text-sm font-black ${tipResult.advice === 'no_entry' ? 'border-rose-300/40 bg-rose-500/15 text-rose-100' : tipResult.advice === 'high_risk' ? 'border-amber-300/40 bg-amber-500/15 text-amber-100' : 'border-emerald-300/40 bg-emerald-500/15 text-emerald-100'}`}>
            {t(lang, tipResult.advice === 'no_entry' ? 'planeTipsRiskNoEntry' : tipResult.advice === 'high_risk' ? 'planeTipsRiskHigh' : 'planeTipsRiskBetter')}
            <p className="mt-2 text-[10px] font-medium leading-relaxed text-white/70">{t(lang, 'planeTipsHistory')} · {tipResult.sampleSize}</p>
          </div>
        )}
        <p className="mt-2 text-[9px] leading-relaxed text-white/50">{t(lang, 'planeTipsHistory')}</p>
      </section>

      {ownBet?.status === 'active' && (
        <section className="sticky top-1 z-40 -mt-1 rounded-2xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-500 via-green-500 to-teal-600 p-2.5 text-white shadow-[0_8px_24px_rgba(5,150,105,.35)]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-bold text-white/85">{lang === 'ar' ? 'المبلغ الذي ستحصل عليه الآن' : lang === 'ru' ? 'СУММА ВЫВОДА СЕЙЧАС' : 'YOUR CASHOUT VALUE'}</div>
              <div className="mt-0.5 text-2xl font-black tabular-nums leading-none">{fmt(ownBet.amount * liveMultiplier)} <span className="text-xs">{lang === 'ar' ? 'عملة' : lang === 'ru' ? 'монет' : 'coins'}</span></div>
              <div className="mt-1 text-[10px] font-bold text-white/80">{liveMultiplier.toFixed(2)}x · {lang === 'ar' ? 'يتحدث لحظيًا' : lang === 'ru' ? 'Текущая сумма' : 'Live value'}</div>
            </div>
            <button onClick={() => void act('cashout')} disabled={!canCashout} className="min-h-[58px] shrink-0 rounded-xl border border-white/40 bg-white px-5 text-base font-black text-emerald-800 shadow-lg transition active:scale-[.97] disabled:opacity-50">
              {loading ? <Loader2 className="mx-auto animate-spin"/> : (lang === 'ar' ? 'اسحب أرباحك' : lang === 'ru' ? 'ЗАБРАТЬ ВЫИГРЫШ' : 'CASH OUT')}
            </button>
          </div>
        </section>
      )}
      <section className="mb-1 rounded-xl border border-emerald-700/20 bg-gradient-to-r from-emerald-50/95 to-teal-50/95 p-3 text-[#245b45] shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-black">{t(lang, 'arenaBuyTokensStore')}</div>
            <p className="mt-1 text-[10px] leading-relaxed text-emerald-800">{t(lang, 'arenaBuyTokenDescription')}</p>
            <div className="mt-1 text-xs font-black text-emerald-900">10,000 · 1 TON</div>
          </div>
          <button type="button" onClick={onBuyTokens} disabled={buyingTokens || !isVerified} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-emerald-500 to-teal-600 px-4 py-3 text-xs font-black text-white shadow-md disabled:opacity-50">
            {buyingTokens ? <Loader2 size={15} className="animate-spin"/> : <span aria-hidden="true">🛒</span>}
            {buyingTokens ? (lang === 'ar' ? 'جارٍ التجهيز…' : lang === 'ru' ? 'Подготовка…' : 'Preparing…') : t(lang, 'arenaBuyTokensButton')}
          </button>
        </div>
        <p className="mt-2 text-[9px] text-emerald-800/75">{t(lang, 'arenaBuyTokensFootnote')}</p>
      </section>
      <section className="rounded-2xl border border-amber-300/20 bg-[#fff5df] p-3 text-[#633715] shadow-lg">
        <div className="mb-2 flex items-center justify-between text-xs"><b>{lang === 'ar' ? 'رهانك' : lang === 'ru' ? 'Ваша ставка' : 'Your bet'}</b><span>{lang === 'ar' ? 'الحد الأدنى 100' : lang === 'ru' ? 'Минимум 100' : 'Min 100'}</span></div>
        {ownBet ? (
          <div className="rounded-xl bg-white p-3">
            <div className="flex items-center justify-between"><b>{fmt(ownBet.amount)} {lang === 'ar' ? 'عملة' : lang === 'ru' ? 'монет' : 'coins'}</b><span className="text-xs font-bold">{ownBet.status === 'active' ? (lang === 'ar' ? 'رهان نشط' : lang === 'ru' ? 'Активна' : 'Active') : ownBet.status === 'cashed_out' ? (lang === 'ar' ? 'تم السحب' : lang === 'ru' ? 'Выведено' : 'Cashed out') : (lang === 'ar' ? 'خاسر' : lang === 'ru' ? 'Проигрыш' : 'Lost')}</span></div>
            {ownBet.status === 'cashed_out' && <div className="mt-2 text-sm font-black text-emerald-700">+{fmt(ownBet.payout - ownBet.amount)} {lang === 'ar' ? 'ربح صافٍ' : lang === 'ru' ? 'чистая прибыль' : 'net profit'} · {ownBet.cashoutMultiplier?.toFixed(2)}x</div>}
            {ownBet.status === 'lost' && <div className="mt-2 text-sm font-black text-rose-600">{lang === 'ar' ? 'خسرت كامل الرهان' : lang === 'ru' ? 'Ставка проиграна' : 'Stake lost'}</div>}
          </div>
        ) : (
          <>
            {previousOwnBet && <div className={`mb-2 rounded-lg px-3 py-2 text-[10px] font-bold ${previousOwnBet.status === 'cashed_out' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}>
              {lang === 'ar' ? 'نتيجتك في الجولة السابقة: ' : lang === 'ru' ? 'Ваш предыдущий раунд: ' : 'Your previous round: '}
              {previousOwnBet.status === 'cashed_out' ? '+' + fmt(previousOwnBet.payout - previousOwnBet.amount) + ' ' + (lang === 'ar' ? 'ربح صافٍ' : lang === 'ru' ? 'чистая прибыль' : 'net profit') + ' · ' + previousOwnBet.cashoutMultiplier?.toFixed(2) + 'x' : (lang === 'ar' ? 'خسرت ' : lang === 'ru' ? 'Проиграно ' : 'Lost ') + fmt(previousOwnBet.amount)}
            </div>}
            <div className="mb-2 flex justify-between text-[10px] text-[#8e6a4b]"><span>{lang === 'ar' ? 'المحفظة العادية' : lang === 'ru' ? 'Кошелёк' : 'Wallet'}: {fmt(state?.balance ?? 0)}</span><span>{lang === 'ar' ? 'عملات الرهان' : lang === 'ru' ? 'Монеты для ставок' : 'Bet tokens'}: {fmt(state?.betBalance ?? 0)}</span></div>
            <input type="number" inputMode="numeric" min="100" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!canBet} className="w-full rounded-xl border border-amber-900/15 bg-white p-3 font-black outline-none focus:border-amber-500 disabled:opacity-50"/>
            <div className="mt-2 grid grid-cols-4 gap-2">{[100,500,1000,5000].map((v) => <button key={v} onClick={() => setAmount(String(v))} disabled={!canBet} className="rounded-lg bg-amber-100 py-2 text-xs font-black disabled:opacity-40">{fmt(v)}</button>)}</div>
            <button onClick={() => void act('bet')} disabled={!canBet || !Number.isSafeInteger(Number(amount)) || Number(amount) < 100 || (Number(amount) > (state?.balance ?? 0) && Number(amount) > (state?.betBalance ?? 0))} className="mt-3 w-full rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 py-3 font-black text-[#44240d] shadow-md disabled:opacity-40">{loading ? <Loader2 className="mx-auto animate-spin"/> : (lang === 'ar' ? 'تأكيد الرهان' : lang === 'ru' ? 'СДЕЛАТЬ СТАВКУ' : 'PLACE BET')}</button>
            <p className="mt-2 text-[9px] text-[#997454]">{lang === 'ar' ? 'يمكن استخدام رصيد عملات الرهان المشتراة أو المحفظة العادية، بشرط أن يغطي أحدهما كامل الرهان.' : lang === 'ru' ? 'Используйте купленные монеты для ставок или обычный кошелёк; один баланс должен покрывать всю ставку.' : 'Use purchased betting tokens or the regular wallet; one balance must cover the full stake.'}</p>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#17213f] p-3">
        <div className="mb-3 flex items-center justify-between"><b className="flex items-center gap-2 text-sm"><Users size={16}/> {lang === 'ar' ? 'المشاركون في الجولة' : lang === 'ru' ? 'Участники раунда' : 'Round players'}</b><span className="rounded-full bg-white/10 px-2 py-1 text-xs">{state?.bets.length ?? 0} · {lang === 'ar' ? 'إجمالي الرهانات' : lang === 'ru' ? 'Общая сумма ставок' : 'Total stakes'}: {fmt(state?.bets.reduce((sum, bet) => sum + bet.amount, 0) ?? 0)}</span></div>
        {!state?.bets.length ? <div className="py-5 text-center text-xs text-white/40">{lang === 'ar' ? 'لم يشارك أحد بعد' : lang === 'ru' ? 'Пока нет участников' : 'No players yet'}</div> : <div className="space-y-2">{state.bets.map((bet) => <div key={bet.telegramId} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-xs"><div className="min-w-0"><div className="truncate font-bold">{bet.username}{bet.telegramId === telegramUserId ? (lang === 'ar' ? ' · أنت' : lang === 'ru' ? ' · Вы' : ' · You') : ''}</div><div className="mt-1 text-[10px] text-white/45">{fmt(bet.amount)} {lang === 'ar' ? 'عملة' : lang === 'ru' ? 'монет' : 'coins'}</div></div><div className="flex items-center gap-2 text-end font-black">{bet.status === 'cashed_out' && <img src="/man.png" alt="" draggable={false} className="h-12 w-9 object-contain drop-shadow-[0_0_8px_rgba(251,191,36,.45)]"/>}<span>{bet.status === 'active' ? <span className="text-amber-300">{lang === 'ar' ? 'مخاطرة' : lang === 'ru' ? 'В игре' : 'In play'}</span> : bet.status === 'cashed_out' ? <span className="text-emerald-300">+{fmt(bet.payout - bet.amount)} · {bet.cashoutMultiplier?.toFixed(2)}x</span> : <span className="text-rose-300">{lang === 'ar' ? 'خسر' : lang === 'ru' ? 'Проигрыш' : 'Lost'} −{fmt(bet.amount)}</span>}</span></div></div>)}</div>}
      </section>

      {state?.previousRound && <section className="rounded-2xl border border-white/10 bg-[#17213f] p-3 text-xs">
        <div className="mb-2 flex items-center gap-2 font-black"><Trophy size={15} className="text-amber-300"/> {lang === 'ar' ? 'نتائج الجولة السابقة' : lang === 'ru' ? 'Результаты предыдущего раунда' : 'Previous round results'} · {state.previousRound.crashMultiplier.toFixed(2)}x {state.previousRound.crashMultiplier <= 1 ? (lang === 'ar' ? '· انفجار قبل الإقلاع' : lang === 'ru' ? '· Мгновенное крушение' : '· Instant crash') : ''}</div>
        <div className="mb-2 rounded-lg bg-white/5 px-3 py-2 text-[10px] text-white/65">{lang === 'ar' ? 'المشاركون ونتيجة كل لاعب في الجولة الماضية' : lang === 'ru' ? 'Участники и результаты предыдущего раунда' : 'Previous round participants and results'} · {state.previousRound.bets.length}</div>
        <div className="space-y-2">{state.previousRound.bets.map((bet) => <div key={bet.telegramId} className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2">
          <div className="min-w-0"><div className="truncate text-xs font-bold">{bet.username}</div><div className="mt-1 text-[10px] text-white/50">{lang === 'ar' ? 'الرهان:' : lang === 'ru' ? 'Ставка:' : 'Stake:'} {fmt(bet.amount)}</div></div>
          <div className="flex shrink-0 items-center gap-2 text-end">{bet.status === 'cashed_out' && <img src="/man.png" alt="" draggable={false} className="h-12 w-9 object-contain"/>}<div><b className={bet.status === 'cashed_out' ? 'text-emerald-300' : 'text-rose-300'}>{bet.status === 'cashed_out' ? (lang === 'ar' ? 'فاز' : lang === 'ru' ? 'ВЫИГРАЛ' : 'WON') : (lang === 'ar' ? 'خسر' : lang === 'ru' ? 'ПРОИГРАЛ' : 'LOST')}</b><div className="mt-1 text-[10px]">{bet.status === 'cashed_out' ? '+' + fmt(bet.payout - bet.amount) + ' · ' + bet.cashoutMultiplier?.toFixed(2) + 'x' : '−' + fmt(bet.amount)}</div></div></div>
        </div>)}</div>
      </section>}

      <div className="rounded-xl border border-amber-200 bg-[#fff3d9] px-3 py-3 text-center text-[11px] font-medium leading-6 text-[#68431f] shadow-sm">
        {lang === 'ar' ? 'تنبيه: هذه لعبة ترفيهية برصيد عملات ARMCO OIL داخل التطبيق، وليست رهانًا نقديًا مباشرًا داخل اللعبة. تخضع العملات لقواعد المحفظة والتبديل العامة للتطبيق.' : lang === 'ru' ? 'Примечание: это внутриигровая игра с использованием монет ARMCO OIL, а не прямая денежная ставка. На монеты распространяются общие правила кошелька и конвертации приложения.' : 'Notice: This is an in-app game using ARMCO OIL coins, not a direct cash wager. Coins remain subject to the app wallet and conversion rules.'}
      </div>
    </div>
  );
}
