'use client';

import { useEffect, useState } from 'react';
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

const MANIFEST = '/api/mining/activation/tonconnect-manifest.json';

export function MiningFeeGate({ initData, onActivated, onClose }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [wallet, setWallet] = useState<import('@tonconnect/ui').TonConnectUI | null>(null);
  const [address, setAddress] = useState('');
  const [savedAddress, setSavedAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const headers = { 'x-telegram-init-data': initData };
    fetch('/api/mining/activation', { headers, cache: 'no-store' })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'تعذر تحميل حالة التفعيل');
        return d as Status;
      })
      .then(d => { if (alive) { setStatus(d); setSavedAddress(d.savedWalletAddress || ''); if (!d.required) onActivated(); } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'تعذر التحقق'); });
    return () => { alive = false; };
  }, [initData, onActivated]);

  useEffect(() => {
    let alive = true;
    let connector: import('@tonconnect/ui').TonConnectUI | null = null;
    let unsubscribe: (() => void) | undefined;
    void import('@tonconnect/ui').then(({ TonConnectUI }) => {
      if (!alive) return;
      connector = new TonConnectUI({
        manifestUrl: new URL(MANIFEST, window.location.origin).toString(),
        restoreConnection: true,
      });
      setWallet(connector);
      unsubscribe = connector.onStatusChange(w => {
        const connected = w?.account?.address || '';
        if (!alive) return;
        setAddress(connected);
        if (connected) {
          setSavedAddress(connected);
          void fetch('/api/mining/activation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
            body: JSON.stringify({ action: 'save_wallet', walletAddress: connected }),
          }).catch(error => console.error('ton_wallet_save_failed', error));
        }
      });
    }).catch(error => {
      console.error('ton_connect_ui_init_failed', error);
      if (alive) setError('تعذر تحميل واجهة ربط محفظة TON. أعد المحاولة بعد تحديث اللعبة.');
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [initData]);

  async function payAndActivate() {
    if (!wallet || !status?.destination || !address) {
      setError('اربط محفظة TON أولًا.');
      return;
    }
    setBusy(true); setError('');
    try {
      const createResponse = await fetch('/api/mining/activation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ action: 'create', walletAddress: address }),
      });
      const created = await createResponse.json();
      if (!createResponse.ok) throw new Error(created.error || 'تعذر إنشاء طلب الدفع');
      const { comment } = await import('@ton/ton');
      const note = comment('ARMCO MINING ' + created.paymentId).toBoc().toString('base64');
      try {
        await wallet.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 600,
          network: '-239',
          messages: [{ address: created.destination, amount: created.amountNanoton, payload: note }],
        });
      } catch (sendError) {
        // Wallet rejection does not create a payment; release the unused intent.
        await fetch('/api/mining/activation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ action: 'cancel', paymentId: created.paymentId }),
        }).catch(() => undefined);
        throw sendError;
      }

      let activated = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2500));
        const response = await fetch('/api/mining/activation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ action: 'verify', paymentId: created.paymentId }),
        });
        const data = await response.json();
        if (response.ok && data.activated) { activated = true; break; }
        if (response.status !== 202 && data.error !== 'payment_not_found_yet') {
          throw new Error(data.error || 'تعذر التحقق من التحويل');
        }
      }
      if (!activated) throw new Error('تم إرسال التحويل، لكن لم يظهر تأكيده على الشبكة بعد. اضغط للتحقق مرة أخرى أو تواصل مع الدعم.');
      onActivated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشلت عملية التفعيل');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#2b1809]/45 p-4 backdrop-blur-sm"><div className="rounded-2xl bg-[#fff8e8] px-5 py-4 text-sm font-bold text-[#6b3b12] shadow-xl">جارٍ التحقق من حالة تفعيل التعدين…</div></div>;
  if (!status.required) return null;

  return (
    <div dir="rtl" className="fixed inset-0 z-[100] flex items-center justify-center bg-[#2b1809]/55 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="mining-fee-title" className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-[#f0c66d] bg-gradient-to-b from-[#fff8e8] via-[#ffedc7] to-[#f8d99d] p-5 text-[#633715] shadow-[0_24px_80px_rgba(65,35,5,.35)]">
        <button type="button" onClick={onClose} disabled={busy} aria-label="إغلاق" className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-[#6a3b13]/10 text-xl font-bold text-[#6a3b13] disabled:opacity-40">×</button>
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-[#e7b94e] bg-gradient-to-br from-[#ffe8a6] to-[#f7b83d] text-[#75400e] shadow-md"><ShieldCheck size={30}/></div>
        <h2 id="mining-fee-title" className="text-center text-xl font-black text-[#633715]">تفعيل التعدين</h2>
        <p className="mt-3 text-center text-sm leading-7 text-[#80562e]">{status.message}</p>
        <div className="my-5 rounded-2xl border border-[#e8c879] bg-white/70 p-4 text-center shadow-inner">
          <p className="text-xs font-bold text-[#956b3b]">رسوم تفعيل تُدفع مرة واحدة مدى الحياة</p>
          <p className="mt-1 text-3xl font-black text-[#bd7814]">0.1 TON</p>
          <p className="mt-2 text-[11px] font-bold text-[#98744a]">TON Mainnet · لا توجد رسوم تفعيل أخرى بعد نجاح الدفع</p>
        </div>
        <div className="mb-4 rounded-xl border border-[#e6c77e] bg-[#fffaf0]/85 p-3 text-xs text-[#80562e]">
          <div className="mb-1 flex items-center gap-2 font-black"><Wallet size={16} className="text-[#b87918]"/> المحفظة المرتبطة بحسابك</div>
          <div className="break-all font-mono text-[11px]" dir="ltr">{address || savedAddress || 'لم يتم ربط محفظة بعد'}</div>
          {savedAddress && <p className="mt-2 font-bold text-emerald-700">تم حفظ عنوان المحفظة في حسابك</p>}
          {address && <p className="mt-1 font-bold text-emerald-700">المحفظة متصلة وجاهزة للدفع</p>}
        </div>
        <button onClick={() => wallet?.openModal()} disabled={!wallet || busy || !!address} className="w-full rounded-xl border border-[#d49b37] bg-white/65 py-3 font-black text-[#805016] shadow-sm disabled:opacity-50">
          {address ? 'تم ربط محفظة TON' : savedAddress ? 'إعادة الاتصال بالمحفظة المحفوظة' : 'ربط محفظة TON'}
        </button>
        <button onClick={payAndActivate} disabled={!address || busy || !status.destination} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f7c34d] to-[#ed8b22] py-3 font-black text-[#4c2908] shadow-lg disabled:opacity-50">
          {busy ? <Loader2 className="animate-spin" size={18}/> : <Wallet size={18}/>} ادفع 0.1 TON وابدأ التعدين
        </button>
        {error && <p className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-center text-xs font-bold text-red-700">{error}</p>}
        {!status.destination && <p className="mt-3 text-center text-xs font-bold text-red-700">إعداد محفظة استقبال رسوم التعدين غير مكتمل على الخادم.</p>}
        <p className="mt-4 text-center text-[10px] leading-5 text-[#98744a]">لن نطلب منك العبارة السرية أو مفاتيح المحفظة. وافق على التحويل من داخل تطبيق المحفظة فقط. رسوم التفعيل دفعة واحدة للحساب مدى الحياة.</p>
      </div>
    </div>
  );
}
