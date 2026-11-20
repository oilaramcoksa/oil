'use client';

import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/lib/store';
import { t, dirOf } from '@/lib/i18n';
import { getTonConnectUI, classifyWalletError } from '@/lib/ton-connect';
import { ShieldCheck, Wallet, Loader2, CheckCircle2 } from 'lucide-react';

type Props = {
  initData: string;
  onActivated: () => void;
  onClose: () => void;
};

type Status = {
  required: boolean;
  exempt: boolean;
  paid: boolean;
  amount: string;
  currency: string;
  destination: string;
  network: string;
  message: string;
  savedWalletAddress?: string;
};

export function MiningFeeGate({ initData, onActivated, onClose }: Props) {
  const lang = useGame((s) => s.lang);
  const [status, setStatus] = useState<Status | null>(null);
  const [wallet, setWallet] = useState<import('@tonconnect/ui').TonConnectUI | null>(null);
  const [address, setAddress] = useState('');
  const [savedAddress, setSavedAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingPaymentId, setPendingPaymentId] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  // Keep latest callbacks/lang in refs so effects never re-run (and re-fetch) on every parent render.
  const onActivatedRef = useRef(onActivated);
  const langRef = useRef(lang);
  onActivatedRef.current = onActivated;
  langRef.current = lang;
  const PENDING_KEY = 'armco_fee_pending_payment';
  const rememberPending = (id: string) => { try { if (id) sessionStorage.setItem(PENDING_KEY, id); else sessionStorage.removeItem(PENDING_KEY); } catch {} };

  useEffect(() => {
    let alive = true;
    const headers = { 'x-telegram-init-data': initData };
    fetch('/api/mining/activation', { headers, cache: 'no-store' })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(t(lang, 'miningFeeLoadError'));
        return d as Status;
      })
      .then(d => {
        if (!alive) return;
        setStatus(d); setSavedAddress(d.savedWalletAddress || '');
        if (!d.required) { rememberPending(''); onActivatedRef.current(); return; }
        // The wallet app may have reloaded the Mini App mid-payment: resume checking instead of asking to pay twice.
        let saved = ''; try { saved = sessionStorage.getItem(PENDING_KEY) || ''; } catch {}
        if (saved) setPendingPaymentId(saved);
      })
      .catch(() => { if (alive) setError(t(langRef.current, 'miningFeeVerifyError')); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initData]);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    void getTonConnectUI().then((connector) => {
      if (!alive) return;
      setWallet(connector);
      const syncWallet = (connected: string) => {
        if (!alive) return;
        setAddress(connected);
        if (!connected) return;
        void fetch('/api/mining/activation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ action: 'save_wallet', walletAddress: connected }),
          cache: 'no-store',
        }).then(async (response) => {
          if (!response.ok) throw new Error('wallet_save_failed');
          if (alive) setSavedAddress(connected);
        }).catch((error) => {
          console.error('ton_wallet_save_failed', error);
          if (alive) setError(t(langRef.current, 'miningFeeWalletUiError'));
        });
      };
      // Read the already-restored session immediately; the callback alone may
      // not emit the current account on every TON Connect UI version.
      const currentAddress = connector.account?.address ?? '';
      setAddress(currentAddress);
      if (currentAddress) syncWallet(currentAddress);
      unsubscribe = connector.onStatusChange((account) => {
        syncWallet(account?.account?.address ?? '');
      });
    }).catch((error) => {
      console.error('ton_connect_ui_init_failed', error);
      if (alive) setError(t(langRef.current, 'miningFeeWalletUiError'));
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [initData]);

  async function verifyPayment(paymentId: string) {
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const response = await fetch('/api/mining/activation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ action: 'verify', paymentId }),
        cache: 'no-store',
      });
      const data = await response.json();
      if (response.ok && data.activated) {
        setPendingPaymentId('');
        rememberPending('');
        onActivatedRef.current();
        return true;
      }
      if (response.status !== 202 && data.error !== 'payment_not_found_yet') {
        throw new Error(data.error || 'mining_fee_verify_failed');
      }
    }
    setPendingPaymentId(paymentId);
    setError(t(lang, 'miningFeeTransferPending'));
    return false;
  }

  async function payAndActivate() {
    if (!wallet || !status?.destination || !address) {
      setError(t(lang, 'miningFeeConnectFirst'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const createResponse = await fetch('/api/mining/activation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ action: 'create', walletAddress: address }),
        cache: 'no-store',
      });
      const created = await createResponse.json();
      if (!createResponse.ok) throw new Error(created.error || 'mining_fee_create_failed');
      const { comment } = await import('@ton/ton');
      const note = comment('ARMCO MINING ' + created.paymentId).toBoc().toString('base64');
      try {
        await wallet.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 600,
          network: '-239',
          messages: [{ address: created.destination, amount: created.amountNanoton, payload: note }],
        });
      } catch (sendError) {
        await fetch('/api/mining/activation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ action: 'cancel', paymentId: created.paymentId }),
        }).catch(() => undefined);
        throw sendError;
      }
      setPendingPaymentId(created.paymentId);
      rememberPending(created.paymentId);
      await verifyPayment(created.paymentId);
    } catch (e) {
      const kind = classifyWalletError(e);
      if (kind === 'rejected') { setError(lang === 'ar' ? 'تم إلغاء العملية من المحفظة. لم يُخصم أي مبلغ، يمكنك المحاولة مرة أخرى.' : 'The request was cancelled in your wallet. Nothing was charged — you can try again.'); }
      else if (kind === 'timeout') { setError(lang === 'ar' ? 'انتهت مهلة تأكيد العملية في المحفظة. حاول مرة أخرى.' : 'The wallet confirmation timed out. Please try again.'); }
      else if (kind === 'not_connected') { setError(t(lang, 'miningFeeConnectFirst')); }
      else { console.error('mining_fee_payment_flow_failed', e); setError(t(lang, 'miningFeePaymentFailed')); }
    } finally {
      setBusy(false);
    }
  }

  async function redeemMiningFeePromo(){
    if(!promoCode.trim()||promoBusy)return;
    setPromoBusy(true);setError('');
    try{
      const response=await fetch('/api/promo-codes/redeem',{method:'POST',headers:{'Content-Type':'application/json','x-telegram-init-data':initData},body:JSON.stringify({code:promoCode}),cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'promo_redemption_failed');
      setStatus(prev=>prev?{...prev,required:false,paid:true}:prev);
      setPromoCode('');
      onActivatedRef.current();
    }catch(e){
      const code=String((e as Error).message||'');
      const ar:Record<string,string>={promo_invalid_or_inactive:'كود غير صحيح أو متوقف',promo_user_limit_reached:'استخدمت هذا الكود الحد المسموح لك',promo_total_limit_reached:'انتهت مرات استخدام هذا الكود',promo_expired:'انتهت صلاحية الكود',mining_fee_already_paid:'رسوم التعدين مفعّلة بالفعل'};
      setError(langRef.current==='ar'?(ar[code]||'تعذر استخدام البرومو كود'):'Could not redeem promo code');
    }finally{setPromoBusy(false);}
  }

  async function retryPaymentVerification() {
    if (!pendingPaymentId || busy) return;
    setBusy(true);
    setError('');
    try {
      await verifyPayment(pendingPaymentId);
    } catch (e) {
      console.error('mining_fee_payment_recheck_failed', e);
      setError(t(lang, 'miningFeeVerifyError'));
    } finally {
      setBusy(false);
    }
  }

  // Keep the status lookup invisible; the fee dialog appears only after the
  // server has confirmed that this player still needs to pay.
  if (!status) return null;
  if (!status.required) return null;

  return (
    <div dir={dirOf(lang)} className="fixed inset-0 z-[100] flex items-center justify-center bg-[#2b1809]/55 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="mining-fee-title" className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-[#f0c66d] bg-gradient-to-b from-[#fff8e8] via-[#ffedc7] to-[#f8d99d] p-5 text-[#633715] shadow-[0_24px_80px_rgba(65,35,5,.35)]">
        <button type="button" onClick={onClose} disabled={busy || !!pendingPaymentId} aria-label={t(lang, 'miningFeeClose')} className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-[#6a3b13]/10 text-xl font-bold text-[#6a3b13] disabled:opacity-40">×</button>
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-[#e7b94e] bg-gradient-to-br from-[#ffe8a6] to-[#f7b83d] text-[#75400e] shadow-md"><ShieldCheck size={30}/></div>
        <h2 id="mining-fee-title" className="text-center text-xl font-black text-[#633715]">{t(lang, 'miningFeeTitle')}</h2>
        <p className="mt-3 text-center text-sm leading-7 text-[#80562e]">{t(lang, 'miningFeeDescription')}</p>
        <div className="my-5 rounded-2xl border border-[#e8c879] bg-white/70 p-4 text-center shadow-inner">
          <p className="text-xs font-bold text-[#956b3b]">{t(lang, 'miningFeeOneTime')}</p>
          <p className="mt-1 text-3xl font-black text-[#bd7814]">0.1 TON</p>
          <p className="mt-2 text-[11px] font-bold text-[#98744a]">{t(lang, 'miningFeeNetwork')}</p>
        </div>
        <div className="mb-4 rounded-xl border border-[#e6c77e] bg-[#fffaf0]/85 p-3 text-xs text-[#80562e]">
          <div className="mb-1 flex items-center gap-2 font-black"><Wallet size={16} className="text-[#b87918]"/> {t(lang, 'miningFeeWalletTitle')}</div>
          <div className="break-all font-mono text-[11px]" dir="ltr">{address || savedAddress || t(lang, 'miningFeeWalletMissing')}</div>
          {savedAddress && <p className="mt-2 font-bold text-emerald-700">{t(lang, 'miningFeeWalletSaved')}</p>}
          {address && <p className="mt-1 font-bold text-emerald-700">{t(lang, 'miningFeeWalletReady')}</p>}
        </div>
        <div className="mb-3 rounded-xl border border-[#e6c77e] bg-white/70 p-3">
          <label className="mb-2 block text-xs font-black text-[#80562e]">{lang==='ar'?'لديك برومو كود لتجاوز رسوم التعدين؟':'Have a promo code to waive the mining fee?'}</label>
          <div className="flex gap-2"><input value={promoCode} onChange={e=>setPromoCode(e.target.value.toUpperCase())} placeholder={lang==='ar'?'أدخل البرومو كود':'Enter promo code'} className="min-w-0 flex-1 rounded-lg border border-[#e6c77e] bg-white p-3 text-sm text-[#633715]"/><button onClick={()=>void redeemMiningFeePromo()} disabled={promoBusy||!promoCode.trim()} className="rounded-lg bg-[#bd7814] px-4 text-sm font-black text-white disabled:opacity-50">{promoBusy?'…':lang==='ar'?'تفعيل':'Apply'}</button></div>
        </div>
        <button onClick={() => wallet?.openModal()} disabled={!wallet || busy || !!address} className="w-full rounded-xl border border-[#d49b37] bg-white/65 py-3 font-black text-[#805016] shadow-sm disabled:opacity-50">
          {address ? t(lang, 'miningFeeConnected') : savedAddress ? t(lang, 'miningFeeReconnect') : t(lang, 'miningFeeConnect')}
        </button>
        {pendingPaymentId ? (
          <button onClick={retryPaymentVerification} disabled={busy} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f7c34d] to-[#ed8b22] py-3 font-black text-[#4c2908] shadow-lg disabled:opacity-50">
            {busy ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle2 size={18}/>} {busy ? t(lang, 'miningFeePay') : lang === 'ar' ? 'تحقق من وصول الدفع' : lang === 'ru' ? 'Проверить оплату' : 'Check payment status'}
          </button>
        ) : (
          <button onClick={payAndActivate} disabled={!address || busy || !status.destination} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f7c34d] to-[#ed8b22] py-3 font-black text-[#4c2908] shadow-lg disabled:opacity-50">
            {busy ? <Loader2 className="animate-spin" size={18}/> : <Wallet size={18}/>} {t(lang, 'miningFeePay')}
          </button>
        )}
        {error && <p className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-center text-xs font-bold text-red-700">{error}</p>}
        {!status.destination && <p className="mt-3 text-center text-xs font-bold text-red-700">{t(lang, 'miningFeeReceiverMissing')}</p>}
        <p className="mt-4 text-center text-[10px] leading-5 text-[#98744a]">{t(lang, 'miningFeeSafety')}</p>
      </div>
    </div>
  );
}
