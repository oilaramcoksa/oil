'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { ArrowUpFromLine, Check, Clock, ShieldCheck, X, Minus, Plus } from 'lucide-react';
import { useGame } from '@/lib/store';
import { t } from '@/lib/i18n';
import {
  COINS_PER_USD,
  MIN_UNITS,
  isValidTonAddress,
  maxUnits,
  unitsToCoins,
  type WithdrawalStatus,
} from '@/lib/withdraw';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const STATUS_STYLE: Record<WithdrawalStatus, { key: string; cls: string; icon: React.ReactNode }> = {
  pending: { key: 'wdStatusPending', cls: 'bg-amber-100 text-amber-700', icon: <Clock className="w-3 h-3" /> },
  paid: { key: 'wdStatusPaid', cls: 'bg-emerald-100 text-emerald-700', icon: <Check className="w-3 h-3" /> },
  rejected: { key: 'wdStatusRejected', cls: 'bg-red-100 text-red-700', icon: <X className="w-3 h-3" /> },
};

function short(addr: string): string {
  return addr.length > 16 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
}

export function WithdrawSection() {
  const lang = useGame((s) => s.lang);
  const coins = useGame((s) => s.coins);
  const savedAddress = useGame((s) => s.tonAddress);
  const withdrawals = useGame((s) => s.withdrawals);
  const requestWithdrawal = useGame((s) => s.requestWithdrawal);
  const syncWithdrawals = useGame((s) => s.syncWithdrawals);

  const [units, setUnits] = useState(MIN_UNITS);
  const [address, setAddress] = useState(savedAddress);
  const [touched, setTouched] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Pull latest statuses on mount and every 30s while the screen is open.
  useEffect(() => {
    syncWithdrawals();
    const id = setInterval(syncWithdrawals, 30000);
    return () => clearInterval(id);
  }, [syncWithdrawals]);

  const max = maxUnits(coins);
  const unlocked = max >= MIN_UNITS;
  const hasPending = withdrawals.some((w) => w.status === 'pending');
  const safeUnits = Math.min(Math.max(units, MIN_UNITS), Math.max(max, MIN_UNITS));
  const addressOk = useMemo(() => isValidTonAddress(address), [address]);
  const progress = Math.min(100, (coins / COINS_PER_USD) * 100);
  const missing = Math.max(0, COINS_PER_USD - coins);
  const canSubmit = unlocked && addressOk && !hasPending && !busy;

  async function submit() {
    setBusy(true);
    const res = await requestWithdrawal(safeUnits, address.trim());
    setBusy(false);
    setConfirmOpen(false);
    if (res.ok) {
      toast.success(t(lang, 'wdSubmitted'));
      setUnits(MIN_UNITS);
    } else {
      toast.error(t(lang, `wdErr_${res.error}`) !== `wdErr_${res.error}` ? t(lang, `wdErr_${res.error}`) : t(lang, 'wdErr_server_error'));
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="aram-card rounded-2xl p-3 mb-3"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center text-white">
          <ArrowUpFromLine className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-black text-[#2a1c0a]">{t(lang, 'wdTitle')}</h3>
          <p className="text-[10px] text-amber-900/60 font-bold">{t(lang, 'wdRate')}</p>
        </div>
      </div>

      <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 mb-3">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
        <p className="text-[10px] font-bold text-emerald-800 leading-relaxed">{t(lang, 'wdNoFee')}</p>
      </div>

      {!unlocked ? (
        <div>
          <div className="flex items-center justify-between text-[10px] font-bold text-amber-900/70 mb-1">
            <span>{t(lang, 'wdProgress')}</span>
            <span className="tabular-nums">{coins.toLocaleString()} / {COINS_PER_USD.toLocaleString()}</span>
          </div>
          <div className="h-2 rounded-full bg-amber-100 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-[10px] text-amber-900/60 font-bold mt-1.5">
            {t(lang, 'wdNeedMore').replace('{n}', missing.toLocaleString())}
          </p>
        </div>
      ) : hasPending ? (
        <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          {t(lang, 'wdPendingBlock')}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] font-bold text-emerald-700">{t(lang, 'wdUnlocked')}</p>

          {/* amount stepper */}
          <div>
            <label className="text-[10px] text-amber-900/60 font-bold uppercase">{t(lang, 'wdAmount')}</label>
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={() => setUnits(Math.max(MIN_UNITS, safeUnits - 1))}
                className="w-9 h-9 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center active:scale-95"
              >
                <Minus className="w-4 h-4" />
              </button>
              <div className="flex-1 text-center">
                <div className="text-lg font-black text-[#2a1c0a] tabular-nums">${safeUnits}</div>
                <div className="text-[10px] text-amber-900/60 font-bold tabular-nums">
                  {unitsToCoins(safeUnits).toLocaleString()} {t(lang, 'coins')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUnits(Math.min(max, safeUnits + 1))}
                className="w-9 h-9 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center active:scale-95"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setUnits(max)}
                className="px-2.5 h-9 rounded-lg bg-amber-500 text-white text-[11px] font-black active:scale-95"
              >
                MAX
              </button>
            </div>
          </div>

          {/* TON address */}
          <div>
            <label className="text-[10px] text-amber-900/60 font-bold uppercase">{t(lang, 'wdAddress')}</label>
            <input
              dir="ltr"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={t(lang, 'wdAddressPh')}
              autoComplete="off"
              spellCheck={false}
              className={`mt-1 w-full px-3 py-2 rounded-xl bg-white/70 border text-xs font-mono outline-none ${
                touched && address && !addressOk ? 'border-red-400' : 'border-amber-200 focus:border-amber-500'
              }`}
            />
            <p className={`text-[10px] font-bold mt-1 ${touched && address && !addressOk ? 'text-red-600' : 'text-amber-900/50'}`}>
              {touched && address && !addressOk ? t(lang, 'wdAddressInvalid') : t(lang, 'wdAddressHint')}
            </p>
          </div>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => setConfirmOpen(true)}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white text-sm font-black disabled:opacity-40 active:scale-[0.98] transition"
          >
            {t(lang, 'wdRequest')} · ${safeUnits}
          </button>
        </div>
      )}

      {/* history */}
      {withdrawals.length > 0 && (
        <div className="mt-3 pt-3 border-t border-amber-200/60">
          <h4 className="text-[11px] font-black text-[#2a1c0a] mb-1.5">{t(lang, 'wdHistory')}</h4>
          <div className="space-y-1.5">
            {withdrawals.slice(0, 5).map((w) => {
              const st = STATUS_STYLE[w.status];
              return (
                <div key={w.id} className="px-2 py-1.5 rounded-lg bg-amber-50/60">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-black text-[#2a1c0a] tabular-nums">${w.usd}</div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black ${st.cls}`}>
                      {st.icon}
                      {t(lang, st.key)}
                    </span>
                  </div>
                  <div dir="ltr" className="text-[10px] text-amber-900/50 font-mono mt-0.5">{short(w.tonAddress)}</div>
                  {w.txHash && (
                    <div className="text-[10px] text-emerald-700 font-bold mt-0.5 break-all">
                      {t(lang, 'wdTx')}: <span dir="ltr" className="font-mono">{w.txHash}</span>
                    </div>
                  )}
                  {w.adminNote && w.status === 'rejected' && (
                    <div className="text-[10px] text-red-700 font-bold mt-0.5">
                      {t(lang, 'wdNote')}: {w.adminNote}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={(o) => !busy && setConfirmOpen(o)}>
        <AlertDialogContent dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(lang, 'wdConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {t(lang, 'wdConfirmBody')
                    .replace('{coins}', unitsToCoins(safeUnits).toLocaleString())
                    .replace('{usd}', String(safeUnits))}
                </p>
                <p dir="ltr" className="font-mono text-xs break-all bg-muted rounded-md p-2">{address.trim()}</p>
                <p className="text-xs">{t(lang, 'wdAddressHint')}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t(lang, 'cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {busy ? t(lang, 'wdSending') : t(lang, 'wdConfirmBtn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
