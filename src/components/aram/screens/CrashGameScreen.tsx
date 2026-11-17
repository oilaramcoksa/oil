'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2, VolumeX, Loader2, Users, Clock3, Trophy, ShieldCheck } from 'lucide-react';
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

export function CrashGameScreen({ initData, isVerified, telegramUserId }: { initData: string; isVerified: boolean; telegramUserId: string }) {
  const lang = useGame((s) => s.lang);
  const soundEnabled = useGame((s) => s.sound);
  const [state, setState] = useState<CrashState | null>(EMPTY);
  const [amount, setAmount] = useState('100');
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [sound, setSound] = useState(soundEnabled);
  const headers = useMemo(() => ({ 'X-Telegram-Init-Data': initData }), [initData]);

  const refresh = useCallback(async () => {
    if (!isVerified || !initData) return;
    const response = await fetch('/api/crash', { headers, cache: 'no-store' });
    if (!response.ok) throw new Error('crash_state_failed');
    const data = await response.json() as CrashState;
    setState(data);
    setServerOffset(data.serverTime - Date.now());
  }, [headers, initData, isVerified]);

  useEffect(() => {
    if (!isVerified) return;
    let alive = true;
    const poll = async () => { try { if (alive) await refresh(); } catch (e) { console.error('crash_refresh_failed', e); } };
    void poll();
    const timer = window.setInterval(() => void poll(), 500);
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
    ? Math.max(1, Math.floor(Math.exp(Math.max(0, serverNow - round.startedAt) / 12_000) * 100) / 100)
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

  useEffect(() => {
    if (recentCrash || round?.status === 'crashed') playTone(110, 0.35);
  // Play once per round, rather than on every polling response.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id, round?.status, state?.previousRound?.id, state?.previousRound?.crashedAt]);

  const curve = useMemo(() => {
    const points = Array.from({ length: 30 }, (_, i) => {
      const x = (i / 29) * 100;
      const y = 92 - (Math.exp((i / 29) * 2.7) - 1) * 10;
      return `${x},${Math.max(8, y)}`;
    });
    return points.join(' ');
  }, []);

  return (
    <div className="mx-auto w-full max-w-md space-y-3 pb-8 text-[#f8e7c6]" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <section className="rounded-2xl border border-amber-300/20 bg-[#111a35] p-3 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div><div className="text-lg font-black">{lang === 'ar' ? 'لعبة الطائرة · CRASH' : 'AIRPLANE · CRASH'}</div><div className="text-[10px] text-amber-100/60">{lang === 'ar' ? 'اسحب أرباحك قبل الانفجار' : 'Cash out before the crash'}</div></div>
          <button onClick={() => setSound((v) => !v)} className="rounded-xl border border-white/15 bg-white/5 p-2" aria-label="Toggle sound">{sound ? <Volume2 size={18}/> : <VolumeX size={18}/>}</button>
        </div>
        <div className="relative h-64 overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(ellipse_at_75%_12%,rgba(251,191,36,.22),transparent_40%),linear-gradient(160deg,#1c2547,#11182f_65%,#241a37)]">
          <div className="absolute inset-0 opacity-20" style={{backgroundImage:'linear-gradient(rgba(255,255,255,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.12) 1px,transparent 1px)',backgroundSize:'42px 42px'}} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            <polyline points={curve} fill="none" stroke="#f59e0b" strokeWidth="1.1" strokeDasharray="2 2" opacity=".28"/>
            {round?.status === 'running' && <polyline points={`0,94 18,89 35,82 50,69 66,48 82,27 100,7`} fill="none" stroke="#fb923c" strokeWidth="1.8" opacity=".9"/>}
          </svg>
          <motion.div
            className="absolute z-10 text-5xl drop-shadow-[0_0_18px_rgba(251,191,36,.65)]"
            animate={recentCrash ? { left: '82%', top: '10%', rotate: 90, scale: [1,1.4,0.7], opacity: [1,1,0] } : round?.status === 'running' ? { left: [ '7%', '80%' ], top: [ '78%', '12%' ], rotate: [ -8, 4, -4, 0 ] } : round?.status === 'crashed' ? { left: '82%', top: '10%', rotate: 90, opacity: [1,0.2,0] } : { left: '7%', top: '78%', rotate: -8, opacity: 1 }}
            transition={recentCrash ? { duration: 0.8, ease: 'easeOut' } : round?.status === 'running' ? { duration: 2.2, repeat: Infinity, ease: 'linear' } : { duration: 0.5 }}
          >✈️</motion.div>
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
        <div className="mt-2 break-all rounded-lg bg-black/20 px-3 py-2 text-[9px] text-white/45">SHA-256 commitment: {round?.seedHash}</div>
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
        <div className="space-y-2">{state.previousRound.bets.map((bet) => <div key={bet.telegramId} className="flex justify-between gap-2"><span className="truncate">{bet.username} · {fmt(bet.amount)}</span><b className={bet.status === 'cashed_out' ? 'text-emerald-300' : 'text-rose-300'}>{bet.status === 'cashed_out' ? '+' + fmt(bet.payout - bet.amount) + ' ' + (lang === 'ar' ? 'ربح صافٍ' : 'net profit') + ' · ' + bet.cashoutMultiplier?.toFixed(2) + 'x' : '−' + fmt(bet.amount)}</b></div>)}</div>
        <div className="mt-3 space-y-1 break-all text-[9px] text-white/40">
          <div className="flex items-center gap-1"><ShieldCheck size={12} className="shrink-0"/> SHA-256: {state.previousRound.seedHash}</div>
          <div>{lang === 'ar' ? 'البذرة بعد الانفجار:' : 'Revealed seed:'} {state.previousRound.revealedSeed}</div>
        </div>
      </section>}

      <div className="rounded-xl border border-amber-300/20 bg-amber-100/10 px-3 py-2 text-center text-[10px] leading-relaxed text-amber-100/65">
        {lang === 'ar' ? 'تنبيه: هذه لعبة ترفيهية برصيد عملات ARMCO OIL داخل التطبيق، وليست رهانًا نقديًا مباشرًا داخل اللعبة. تخضع العملات لقواعد المحفظة والتبديل العامة للتطبيق.' : 'Notice: This is an in-app game using ARMCO OIL coins, not a direct cash wager. Coins remain subject to the app's wallet and conversion rules.'}
      </div>
    </div>
  );
}
