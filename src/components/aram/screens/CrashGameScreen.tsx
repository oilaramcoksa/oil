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
  const [now, setNow] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [sound, setSound] = useState(soundEnabled);
  const [showExplosion, setShowExplosion] = useState(false);
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
    ? Math.min(1000, Math.floor((1 + Math.max(0, serverNow - round.startedAt) / 10_000) * 10) / 10)
    : round?.status === 'crashed' ? (round.crashMultiplier ?? 1) : 1;
  const recentCrash = Boolean(state?.previousRound?.crashedAt && serverNow - state.previousRound.crashedAt < 3_500);
  const ownBet = state?.bets.find((bet) => bet.telegramId === telegramUserId);
  const previousOwnBet = state?.previousRound?.bets.find((bet) => bet.telegramId === telegramUserId);
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
        toast.error(lang === 'ar' ? 'المبلغ غير صالح أو لا يوجد رصيد كافٍ في محفظة واحدة' : 'Invalid amount or insufficient balance in one wallet');
        return;
      }
    }
    setLoading(true);
    try {
      const response = await fetch('/api/crash', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(action === 'bet' ? { amount: Number(amount) } : {}) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messages: Record<string,string> = {
          betting_closed: lang === 'ar' ? 'أُغلق باب المشاركة لهذه الجولة' : 'Betting is closed for this round',
          insufficient_balance: lang === 'ar' ? 'الرصيد غير كافٍ في محفظة واحدة' : 'Insufficient balance in one wallet',
          already_joined: lang === 'ar' ? 'شاركت بالفعل في هذه الجولة' : 'You already joined this round',
          round_crashed: lang === 'ar' ? 'انفجرت الطائرة قبل قبول السحب؛ خسرت الرهان' : 'The plane crashed before cashout was accepted',
          bet_not_found: lang === 'ar' ? 'لم تشارك في هذه الجولة' : 'No bet found for this round',
        };
        throw new Error(messages[String(data.error)] ?? String(data.error ?? 'crash_action_failed'));
      }
      if (action === 'bet') { toast.success(lang === 'ar' ? 'تم تسجيل رهانك للجولة القادمة' : 'Your bet is registered'); playTone(560); }
      else { toast.success((lang === 'ar' ? 'تم السحب عند ' : 'Cashed out at ') + Number(data.multiplier).toFixed(2) + 'x · +' + fmt(Number(data.payout))); playTone(880, 0.2); }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'crash_action_failed');
      if (action === 'cashout') playTone(180, 0.25);
      await refresh().catch(() => undefined);
    } finally { setLoading(false); }
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
      window.setTimeout(() => setShowExplosion(false), 1_150);
    }, 240);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explosionKey, round?.status, state?.previousRound?.crashedAt]);

  return (
    <div className="mx-auto w-full max-w-md space-y-3 pb-8 text-[#f8e7c6]" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <section className="rounded-2xl border border-amber-300/20 bg-[#111a35] p-3 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div><div className="text-lg font-black">{lang === 'ar' ? 'ARMCOFLY · لعبة الطائرة' : 'ARMCOFLY · CRASH'}</div><div className="text-[10px] text-amber-100/60">{lang === 'ar' ? 'اسحب أرباحك قبل الانفجار' : 'Cash out before the crash'}</div></div>
          <button onClick={() => setSound((v) => !v)} className="rounded-xl border border-white/15 bg-white/5 p-2" aria-label="Toggle sound">{sound ? <Volume2 size={18}/> : <VolumeX size={18}/>}</button>
        </div>
        <div className="relative h-72 overflow-hidden rounded-xl border border-sky-200/15 bg-[linear-gradient(180deg,#07152f_0%,#102d52_48%,#f28b4b_100%)] shadow-[inset_0_0_55px_rgba(4,12,32,.55)]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_72%_22%,rgba(255,220,145,.42),transparent_20%),radial-gradient(ellipse_at_50%_75%,rgba(249,115,22,.3),transparent_48%)]" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#f28b4b]/35 to-transparent" />
          <motion.div
            className="absolute inset-y-0 left-0 w-[200%]"
            animate={{ x: ['0%', '-50%'] }}
            transition={{ duration: Math.max(2.2, 18 / Math.max(1, liveMultiplier)), repeat: Infinity, ease: 'linear' }}
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
            transition={{ duration: Math.max(1.1, 9 / Math.max(1, liveMultiplier)), repeat: Infinity, ease: 'linear' }}
          >
            <svg viewBox="0 0 1200 290" preserveAspectRatio="none" className="h-full w-full">
              <g fill="#fff" opacity=".42">
                <path d="M90 190c8-19 34-24 49-8 16-13 42-3 44 17H79c-8-3-4-9 11-9zm360-96c9-22 39-26 54-8 18-15 46-4 48 19H438c-9-4-4-11 12-11zm420 145c8-18 32-22 46-7 15-12 38-2 40 16H860c-7-3-3-9 10-9z"/>
              </g>
            </svg>
          </motion.div>
          <div className="absolute inset-0 opacity-20" style={{backgroundImage:'radial-gradient(#fff 0.7px,transparent 0.7px)',backgroundSize:'34px 34px'}} />
          <motion.div
            className="absolute left-1/2 top-[53%] z-20 -translate-x-1/2 -translate-y-1/2"
            animate={recentCrash || round?.status === 'crashed'
              ? { y: [0, -8, 18], rotate: [0, 18, 75], scale: [1, 1.08, .72], opacity: [1, 1, 0] }
              : round?.status === 'running'
                ? { y: [0, -3, 0], rotate: [-13, -11, -13], scale: [1, 1.015, 1] }
                : { y: [0, -2, 0], rotate: -13, scale: 1, opacity: 1 }}
            transition={round?.status === 'running' ? { duration: .9, repeat: Infinity, ease: 'easeInOut' } : { duration: .75, ease: 'easeOut' }}
          >
            <svg viewBox="0 0 260 150" className="h-28 w-52 drop-shadow-[0_12px_20px_rgba(0,0,0,.45)]" role="img" aria-label="ARMCOFLY aircraft">
              <defs>
                <linearGradient id="armcoPlaneBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff"/><stop offset=".48" stopColor="#c9d8e8"/><stop offset="1" stopColor="#71869f"/></linearGradient>
                <linearGradient id="armcoPlaneWing" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f8fbff"/><stop offset="1" stopColor="#8ea6c0"/></linearGradient>
              </defs>
              <path d="M22 79 Q35 68 74 66 L206 61 Q230 62 247 72 Q231 84 205 87 L74 91 Q37 91 22 79Z" fill="url(#armcoPlaneBody)" stroke="#607b98" strokeWidth="2"/>
              <path d="M106 70 L153 14 Q160 6 169 12 L155 69Z" fill="url(#armcoPlaneWing)" stroke="#7d94ad" strokeWidth="2"/>
              <path d="M112 87 L164 135 Q171 142 179 136 L158 84Z" fill="#a9bdd2" stroke="#6e849d" strokeWidth="2"/>
              <path d="M44 75 L20 47 Q15 41 9 45 L23 79Z" fill="#dce8f4" stroke="#7d94ad" strokeWidth="2"/>
              <path d="M43 85 L19 108 Q15 113 9 109 L24 81Z" fill="#8fa6bf" stroke="#6e849d" strokeWidth="2"/>
              <path d="M181 65 Q195 45 211 53 L220 66Z" fill="#38bdf8" opacity=".9"/>
              <path d="M195 78h27" stroke="#f59e0b" strokeWidth="5" strokeLinecap="round"/>
              <path d="M62 74h92" stroke="#f59e0b" strokeWidth="3" opacity=".9"/>
              <g fill="#263c55" stroke="#e6f0fa" strokeWidth="2"><ellipse cx="91" cy="93" rx="9" ry="5"/><ellipse cx="91" cy="61" rx="9" ry="5"/></g>
              <path d="M238 73l13 6-13 6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="absolute -left-10 top-1/2 h-1 w-12 -translate-y-1/2 rounded-full bg-gradient-to-l from-sky-100/60 to-transparent blur-[2px]" />
          </motion.div>
          {round?.status === 'running' && <motion.div className="absolute left-1/2 top-[53%] z-10 h-36 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-300/10 blur-2xl" animate={{ scale: [1, 1.15, 1], opacity: [.35, .65, .35] }} transition={{ duration: 1.4, repeat: Infinity }} />}
          {showExplosion && <motion.div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.05, times: [0, .18, 1] }}>
            <motion.div className="absolute left-1/2 top-[53%] h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-200/90 blur-md" initial={{ scale: .15 }} animate={{ scale: [0.15, 3.6, 5.2], opacity: [1, .85, 0] }} transition={{ duration: .85, ease: 'easeOut' }}/>
            <motion.div className="absolute left-1/2 top-[53%] h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] border-orange-300" initial={{ scale: .3, opacity: 1 }} animate={{ scale: [0.3, 5.5], opacity: [1, 0] }} transition={{ duration: .9, ease: 'easeOut' }}/>
            {Array.from({length:14},(_,i)=><motion.i key={i} className="absolute left-1/2 top-[53%] h-2 w-2 rounded-full bg-gradient-to-br from-yellow-100 to-orange-500 shadow-[0_0_12px_rgba(251,146,60,.9)]" initial={{ x: 0, y: 0, scale: 1, opacity: 1 }} animate={{ x: Math.cos(i*Math.PI/7)*150, y: Math.sin(i*Math.PI/7)*105, scale: 0, opacity: 0 }} transition={{ duration: .85, ease: 'easeOut' }}/>)}
          </motion.div>}
          <div className="absolute inset-x-0 bottom-3 text-center">
            <div className={`text-5xl font-black tabular-nums tracking-tight ${round?.status === 'crashed' ? 'text-rose-400' : 'text-white'}`}>
              {recentCrash || round?.status === 'crashed' ? (lang === 'ar' ? 'انفجار!' : 'CRASHED!') : liveMultiplier.toFixed(2) + 'x'}
            </div>
            <div className="mt-1 text-[10px] font-bold text-amber-100/65">
              {round?.status === 'countdown' ? (lang === 'ar' ? 'تبدأ الجولة خلال' : 'Next flight in') + ' ' + secondsLeft + 's' : round?.status === 'running' ? (lang === 'ar' ? 'الطائرة في الجو' : 'Plane is flying') : (lang === 'ar' ? 'انفجرت عند ' : 'Crashed at ') + (round?.crashMultiplier?.toFixed(2) ?? '—') + 'x'}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-[10px] text-amber-100/70">
          <span className="flex items-center gap-1"><Clock3 size={13}/> {round?.status === 'countdown' ? (lang === 'ar' ? 'إغلاق الرهان بعد' : 'Betting closes in') : round?.status === 'running' ? (lang === 'ar' ? 'جولة مباشرة' : 'Live round') : (lang === 'ar' ? 'استراحة الجولة' : 'Round break')}</span>
          <b className="text-amber-300">{round?.status === 'countdown' ? secondsLeft + 's' : round?.status === 'running' ? liveMultiplier.toFixed(2) + 'x' : '50s'}</b>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-300/20 bg-[#fff5df] p-3 text-[#633715] shadow-lg">
        <div className="mb-2 flex items-center justify-between text-xs"><b>{lang === 'ar' ? 'رهانك' : 'Your bet'}</b><span>{lang === 'ar' ? 'الحد الأدنى 100' : 'Min 100'}</span></div>
        {ownBet ? (
          <div className="rounded-xl bg-white p-3">
            <div className="flex items-center justify-between"><b>{fmt(ownBet.amount)} {lang === 'ar' ? 'عملة' : 'coins'}</b><span className="text-xs font-bold">{ownBet.status === 'active' ? (lang === 'ar' ? 'رهان نشط' : 'Active') : ownBet.status === 'cashed_out' ? (lang === 'ar' ? 'تم السحب' : 'Cashed out') : (lang === 'ar' ? 'خاسر' : 'Lost')}</span></div>
            {ownBet.status === 'active' && <button onClick={() => void act('cashout')} disabled={!canCashout} className="mt-3 w-full rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 py-4 text-lg font-black text-white shadow-lg disabled:opacity-40">{loading ? <Loader2 className="mx-auto animate-spin"/> : (lang === 'ar' ? 'اسحب الآن' : 'CASH OUT')} · {liveMultiplier.toFixed(2)}x</button>}
            {ownBet.status === 'cashed_out' && <div className="mt-2 text-sm font-black text-emerald-700">+{fmt(ownBet.payout - ownBet.amount)} {lang === 'ar' ? 'ربح صافٍ' : 'net profit'} · {ownBet.cashoutMultiplier?.toFixed(2)}x</div>}
            {ownBet.status === 'lost' && <div className="mt-2 text-sm font-black text-rose-600">{lang === 'ar' ? 'خسرت كامل الرهان' : 'Stake lost'}</div>}
          </div>
        ) : (
          <>
            {previousOwnBet && <div className={`mb-2 rounded-lg px-3 py-2 text-[10px] font-bold ${previousOwnBet.status === 'cashed_out' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}>
              {lang === 'ar' ? 'نتيجتك في الجولة السابقة: ' : 'Your previous round: '}
              {previousOwnBet.status === 'cashed_out' ? '+' + fmt(previousOwnBet.payout - previousOwnBet.amount) + ' ' + (lang === 'ar' ? 'ربح صافٍ' : 'net profit') + ' · ' + previousOwnBet.cashoutMultiplier?.toFixed(2) + 'x' : (lang === 'ar' ? 'خسرت ' : 'Lost ') + fmt(previousOwnBet.amount)}
            </div>}
            <div className="mb-2 flex justify-between text-[10px] text-[#8e6a4b]"><span>{lang === 'ar' ? 'المحفظة العادية' : 'Wallet'}: {fmt(state?.balance ?? 0)}</span><span>{lang === 'ar' ? 'عملات الرهان' : 'Bet tokens'}: {fmt(state?.betBalance ?? 0)}</span></div>
            <button type="button" onClick={onBuyTokens} disabled={buyingTokens || !isVerified} className="mb-3 flex w-full items-center justify-between rounded-xl border border-amber-300/40 bg-gradient-to-r from-amber-100 to-orange-100 px-3 py-3 text-start text-xs font-black text-[#633715] shadow-sm disabled:opacity-50">
              <span>{buyingTokens ? (lang === 'ar' ? 'جارٍ تجهيز عملية الشراء…' : 'Preparing purchase…') : (lang === 'ar' ? 'شراء عملات رهان للطائرة' : 'Buy flight betting tokens')}</span>
              <span className="rounded-lg bg-amber-400 px-3 py-2 text-[#42230c]">10,000 · 1 TON</span>
            </button>
            <input type="number" inputMode="numeric" min="100" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!canBet} className="w-full rounded-xl border border-amber-900/15 bg-white p-3 font-black outline-none focus:border-amber-500 disabled:opacity-50"/>
            <div className="mt-2 grid grid-cols-4 gap-2">{[100,500,1000,5000].map((v) => <button key={v} onClick={() => setAmount(String(v))} disabled={!canBet} className="rounded-lg bg-amber-100 py-2 text-xs font-black disabled:opacity-40">{fmt(v)}</button>)}</div>
            <button onClick={() => void act('bet')} disabled={!canBet || !Number.isSafeInteger(Number(amount)) || Number(amount) < 100 || (Number(amount) > (state?.balance ?? 0) && Number(amount) > (state?.betBalance ?? 0))} className="mt-3 w-full rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 py-3 font-black text-[#44240d] shadow-md disabled:opacity-40">{loading ? <Loader2 className="mx-auto animate-spin"/> : (lang === 'ar' ? 'تأكيد الرهان' : 'PLACE BET')}</button>
            <p className="mt-2 text-[9px] text-[#997454]">{lang === 'ar' ? 'يمكن استخدام رصيد عملات الرهان المشتراة أو المحفظة العادية، بشرط أن يغطي أحدهما كامل الرهان.' : 'Use purchased betting tokens or the regular wallet; one balance must cover the full stake.'}</p>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#17213f] p-3">
        <div className="mb-3 flex items-center justify-between"><b className="flex items-center gap-2 text-sm"><Users size={16}/> {lang === 'ar' ? 'المشاركون في الجولة' : 'Round players'}</b><span className="rounded-full bg-white/10 px-2 py-1 text-xs">{state?.bets.length ?? 0} · {lang === 'ar' ? 'إجمالي الرهانات' : 'Total stakes'}: {fmt(state?.bets.reduce((sum, bet) => sum + bet.amount, 0) ?? 0)}</span></div>
        {!state?.bets.length ? <div className="py-5 text-center text-xs text-white/40">{lang === 'ar' ? 'لم يشارك أحد بعد' : 'No players yet'}</div> : <div className="space-y-2">{state.bets.map((bet) => <div key={bet.telegramId} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-xs"><div className="min-w-0"><div className="truncate font-bold">{bet.username}{bet.telegramId === telegramUserId ? (lang === 'ar' ? ' · أنت' : ' · You') : ''}</div><div className="mt-1 text-[10px] text-white/45">{fmt(bet.amount)} {lang === 'ar' ? 'عملة' : 'coins'}</div></div><div className="text-end font-black">{bet.status === 'active' ? <span className="text-amber-300">{lang === 'ar' ? 'مخاطرة' : 'In play'}</span> : bet.status === 'cashed_out' ? <span className="text-emerald-300">+{fmt(bet.payout - bet.amount)} · {bet.cashoutMultiplier?.toFixed(2)}x</span> : <span className="text-rose-300">{lang === 'ar' ? 'خسر' : 'Lost'} −{fmt(bet.amount)}</span>}</div></div>)}</div>}
      </section>

      {state?.previousRound && <section className="rounded-2xl border border-white/10 bg-[#17213f] p-3 text-xs">
        <div className="mb-2 flex items-center gap-2 font-black"><Trophy size={15} className="text-amber-300"/> {lang === 'ar' ? 'نتائج الجولة السابقة' : 'Previous round results'} · {state.previousRound.crashMultiplier.toFixed(2)}x {state.previousRound.crashMultiplier <= 1 ? (lang === 'ar' ? '· انفجار قبل الإقلاع' : '· Instant crash') : ''}</div>
        <div className="mb-2 rounded-lg bg-white/5 px-3 py-2 text-[10px] text-white/65">{lang === 'ar' ? 'المشاركون ونتيجة كل لاعب في الجولة الماضية' : 'Previous round participants and results'} · {state.previousRound.bets.length}</div>
        <div className="space-y-2">{state.previousRound.bets.map((bet) => <div key={bet.telegramId} className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2">
          <div className="min-w-0"><div className="truncate text-xs font-bold">{bet.username}</div><div className="mt-1 text-[10px] text-white/50">{lang === 'ar' ? 'الرهان:' : 'Stake:'} {fmt(bet.amount)}</div></div>
          <div className="shrink-0 text-end"><b className={bet.status === 'cashed_out' ? 'text-emerald-300' : 'text-rose-300'}>{bet.status === 'cashed_out' ? (lang === 'ar' ? 'فاز' : 'WON') : (lang === 'ar' ? 'خسر' : 'LOST')}</b><div className="mt-1 text-[10px]">{bet.status === 'cashed_out' ? '+' + fmt(bet.payout - bet.amount) + ' · ' + bet.cashoutMultiplier?.toFixed(2) + 'x' : '−' + fmt(bet.amount)}</div></div>
        </div>)}</div>
      </section>}

      <div className="rounded-xl border border-amber-200 bg-[#fff3d9] px-3 py-3 text-center text-[11px] font-medium leading-6 text-[#68431f] shadow-sm">
        {lang === 'ar' ? 'تنبيه: هذه لعبة ترفيهية برصيد عملات ARMCO OIL داخل التطبيق، وليست رهانًا نقديًا مباشرًا داخل اللعبة. تخضع العملات لقواعد المحفظة والتبديل العامة للتطبيق.' : 'Notice: This is an in-app game using ARMCO OIL coins, not a direct cash wager. Coins remain subject to the app wallet and conversion rules.'}
      </div>
    </div>
  );
}
