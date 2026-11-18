'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { ArrowUpFromLine, Check, Clock, ShieldCheck, X, Minus, Plus, Loader2 } from 'lucide-react';
import { useGame } from '@/lib/store';
import { t } from '@/lib/i18n';
import { getTonConnectUI } from '@/lib/ton-connect';
import {
  COINS_PER_USD,
  MIN_UNITS,
  isValidTonAddress,
  maxUnits,
  unitsToCoins,
  type WithdrawalStatus,
} from '@/lib/withdraw';
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

  const feeStorageKey = typeof window !== 'undefined' ? 'armcooil:withdrawal-fee:' + String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id ?? 'guest') : 'armcooil:withdrawal-fee:guest';
  const [units, setUnits] = useState(MIN_UNITS);
  const [address, setAddress] = useState(savedAddress);
  const [touched, setTouched] = useState(false);
  const [pendingFeePaymentId, setPendingFeePaymentId] = useState<string | null>(() => typeof window !== 'undefined' ? window.sessionStorage.getItem(feeStorageKey) : null);
  const [tonConnector, setTonConnector] = useState<import('@tonconnect/ui').TonConnectUI | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, setClockTick] = useState(0);
  const actionGateRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void getTonConnectUI().then((connector) => {
      if (alive) setTonConnector(connector);
    }).catch((error) => console.error('withdrawal_tonconnect_init_failed', error));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (pendingFeePaymentId) window.sessionStorage.setItem(feeStorageKey, pendingFeePaymentId);
    else window.sessionStorage.removeItem(feeStorageKey);
  }, [pendingFeePaymentId, feeStorageKey]);

  useEffect(() => {
    if (withdrawals.length && !withdrawals.some((item) => item.status === 'pending')) setSubmitted(false);
  }, [withdrawals]);

  // Refresh the cooldown display every second.
  useEffect(() => {
    const id = setInterval(() => setClockTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Pull latest statuses on mount and every 30s while the screen is open.
  useEffect(() => {
    syncWithdrawals();
    const id = setInterval(syncWithdrawals, 30000);
    return () => clearInterval(id);
  }, [syncWithdrawals]);

  const max = maxUnits(coins);
  const unlocked = max >= MIN_UNITS;
  const lastWithdrawalAt = withdrawals.reduce((latest, item) => Math.max(latest, Number(item.createdAt) || 0), 0);
  const cooldownRemainingMs = Math.max(0, lastWithdrawalAt + 48 * 60 * 60 * 1000 - Date.now());
  const safeUnits = Math.min(Math.max(units, MIN_UNITS), Math.max(max, MIN_UNITS));
  const addressOk = useMemo(() => isValidTonAddress(address), [address]);
  const minimumCoins = MIN_UNITS * COINS_PER_USD;
  const progress = Math.min(100, (coins / minimumCoins) * 100);
  const missing = Math.max(0, minimumCoins - coins);
  const hasPendingRequest = submitted || withdrawals.some((item) => item.status === 'pending');
  const canSubmit = unlocked && addressOk && cooldownRemainingMs <= 0 && !busy && !hasPendingRequest;
  const reviewText: Record<string, string> = {"ar":"تم تقديم طلب السحب وهو تحت المراجعة","en":"Withdrawal request submitted — under review","ru":"Заявка на вывод отправлена и проверяется","es":"Solicitud enviada; pendiente de revisión","pt":"Solicitação enviada; aguardando análise","fr":"Demande envoyée, en cours de vérification","de":"Auszahlungsantrag eingereicht – wird geprüft","tr":"Çekim talebi gönderildi, inceleniyor","zh":"提现申请已提交，正在审核","hi":"निकासी अनुरोध भेज दिया गया है और समीक्षा में है","id":"Permintaan penarikan dikirim dan sedang ditinjau","bn":"উত্তোলনের আবেদন জমা হয়েছে, পর্যালোচনাধীন","ja":"出金申請を送信しました。審査中です","ko":"출금 요청이 제출되어 검토 중입니다","ur":"رقم نکلوانے کی درخواست جمع ہو گئی ہے اور زیرِ جائزہ ہے"};
  const withdrawButtonText: Record<string, string> = { ar: 'سحب', en: 'Withdraw', ru: 'Вывести', es: 'Retirar', pt: 'Sacar', fr: 'Retirer', de: 'Auszahlen', tr: 'Çek', zh: '提现', hi: 'निकासी', id: 'Tarik', bn: 'উত্তোলন', ja: '出金', ko: '출금', ur: 'رقم نکالیں' };

  async function submit() {
    if (actionGateRef.current || busy || !tonConnector) return;
    actionGateRef.current = true;
    setBusy(true);
    let walletApproved = Boolean(pendingFeePaymentId);
    try {
      const initData = window.Telegram?.WebApp?.initData ?? '';
      if (!initData) throw new Error('telegram_auth_required');
      if (!tonConnector.connected) {
        await tonConnector.openModal();
        if (!tonConnector.connected) throw new Error('ton_wallet_not_connected');
      }
      let paymentId = pendingFeePaymentId;
      if (!paymentId) {
        const intentResponse = await fetch('/api/withdrawal-fee', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
          body: JSON.stringify({ units: safeUnits, tonAddress: address.trim() }),
          cache: 'no-store',
        });
        const intentData = await intentResponse.json().catch(() => ({}));
        if (!intentResponse.ok || !intentData.payment?.id) throw new Error(intentData.error ?? 'payment_intent_failed');
        paymentId = String(intentData.payment.id);
        setPendingFeePaymentId(paymentId);
        const commentBytes = new TextEncoder().encode(String(intentData.payment.comment));
        const bytes = new Uint8Array(4 + commentBytes.length);
        new DataView(bytes.buffer).setUint32(0, 0, false);
        bytes.set(commentBytes, 4);
        let binary = '';
        bytes.forEach((value) => { binary += String.fromCharCode(value); });
        await tonConnector.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 600,
          messages: [{ address: String(intentData.payment.destination), amount: String(intentData.payment.amountNanoton), payload: btoa(binary) }],
        });
        walletApproved = true;
      }
      let confirmed = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const statusResponse = await fetch('/api/withdrawal-fee?id=' + encodeURIComponent(paymentId), {
          headers: { 'X-Telegram-Init-Data': initData }, cache: 'no-store',
        });
        const statusData = await statusResponse.json().catch(() => ({}));
        if (!statusResponse.ok) throw new Error(statusData.error ?? 'payment_verification_failed');
        if (statusData.payment?.status === 'confirmed') { confirmed = true; break; }
        if (statusData.payment?.status === 'expired' || statusData.payment?.status === 'rejected') throw new Error('payment_expired');
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error('payment_verification_pending');
      const result = await requestWithdrawal(safeUnits, address.trim(), paymentId);
      if (!result.ok) throw new Error(result.error);
      setPendingFeePaymentId(null);
      setSubmitted(true);
      setUnits(MIN_UNITS);
      await syncWithdrawals();
      toast.success(reviewText[lang] ?? reviewText.en);
    } catch (error) {
      if (!walletApproved) setPendingFeePaymentId(null);
      const message = error instanceof Error ? error.message : 'server_error';
      if (message === 'payment_verification_pending') {
        toast.info(lang === 'ar' ? 'تم إرسال الدفع، جارٍ التحقق منه. اضغط سحب مجددًا لإكمال الطلب دون دفع مرة أخرى.' : 'Payment sent. Verification is pending; press Withdraw again to continue without paying again.');
      } else {
        const errorKey = 'wdErr_' + message;
        toast.error(t(lang, errorKey) !== errorKey ? t(lang, errorKey) : message);
      }
    } finally {
      setBusy(false);
      actionGateRef.current = false;
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

      <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-xl bg-sky-50 border border-sky-200 mb-3">
        <ShieldCheck className="w-3.5 h-3.5 text-sky-600 mt-0.5 flex-shrink-0" />
        <p className="text-[10px] font-bold text-sky-800 leading-relaxed">{({ar:'يتم تأكيد الدفع على شبكة TON قبل إرسال طلب السحب للمراجعة.',en:'Your payment is verified on TON before the withdrawal request is submitted for review.',ru:'Платёж проверяется в сети TON до отправки заявки на вывод.',es:'El pago se verifica en TON antes de enviar la solicitud de retiro.',pt:'O pagamento é verificado na TON antes do envio do pedido de saque.',fr:'Le paiement est vérifié sur TON avant l’envoi de la demande de retrait.',de:'Die Zahlung wird auf TON bestätigt, bevor der Auszahlungsantrag eingereicht wird.',tr:'Çekim talebi gönderilmeden önce ödeme TON ağında doğrulanır.',zh:'付款将在 TON 网络确认后提交提现申请。',hi:'निकासी अनुरोध भेजने से पहले TON नेटवर्क पर भुगतान सत्यापित किया जाता है।',id:'Pembayaran diverifikasi di jaringan TON sebelum permintaan penarikan diajukan.',bn:'উত্তোলনের আবেদন পাঠানোর আগে TON নেটওয়ার্কে পেমেন্ট যাচাই করা হয়।',ja:'出金申請の送信前に、TONネットワークで支払いを確認します。',ko:'출금 요청을 제출하기 전에 TON 네트워크에서 결제를 확인합니다.',ur:'رقم نکلوانے کی درخواست بھیجنے سے پہلے TON نیٹ ورک پر ادائیگی کی تصدیق ہوتی ہے。'} as Record<string,string>)[lang] ?? 'Payment is verified on TON before the withdrawal request is submitted.'}</p>
      </div>

      {!unlocked ? (
        <div>
          <div className="flex items-center justify-between text-[10px] font-bold text-amber-900/70 mb-1">
            <span>{t(lang, 'wdProgress')}</span>
            <span className="tabular-nums">{coins.toLocaleString()} / {minimumCoins.toLocaleString()}</span>
          </div>
          <div className="h-2 rounded-full bg-amber-100 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-[10px] text-amber-900/60 font-bold mt-1.5">
            {t(lang, 'wdNeedMore').replace('{n}', missing.toLocaleString())}
          </p>
        </div>
      ) : cooldownRemainingMs > 0 ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-center">
          {hasPendingRequest ? (
            <div className="text-[11px] font-black text-emerald-800">{reviewText[lang] ?? reviewText.en}</div>
          ) : (
            <>
              <div className="text-[11px] font-black text-sky-800">{t(lang, 'withdrawCooldown')}</div>
              <div className="mt-1 text-2xl font-black tabular-nums tracking-wider text-sky-700">{formatCooldown(cooldownRemainingMs)}</div>
              <div className="mt-1 text-[10px] font-bold text-sky-700/70">48 {lang === 'ar' ? 'ساعة بين كل طلب سحب' : lang === 'ru' ? 'часов между запросами на вывод' : 'hours between withdrawals'}</div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] font-bold text-emerald-700">{t(lang, 'wdUnlocked')}</p>

          {/* amount stepper */}
          <div>
            <label className="text-[10px] text-amber-900/60 font-bold uppercase">{t(lang, 'wdAmount')}</label>
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                disabled={Boolean(pendingFeePaymentId)}
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
                disabled={Boolean(pendingFeePaymentId)}
                onClick={() => setUnits(Math.min(max, safeUnits + 1))}
                className="w-9 h-9 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center active:scale-95"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={Boolean(pendingFeePaymentId)}
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
              disabled={Boolean(pendingFeePaymentId)}
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
            disabled={!canSubmit || !tonConnector}
            onClick={submit}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white text-sm font-black disabled:opacity-40 active:scale-[0.98] transition"
          >
            {busy ? <><Loader2 className="w-4 h-4 animate-spin inline mr-2" />{lang === 'ar' ? 'جارٍ تنفيذ السحب...' : 'Processing...'}</> : hasPendingRequest ? (reviewText[lang] ?? reviewText.en) : (withdrawButtonText[lang] ?? withdrawButtonText.en)}
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


    </motion.div>
  );
}


function formatCooldown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}
