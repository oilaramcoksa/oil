'use client';

import { useEffect, useState } from 'react';
import { TonConnectUI } from '@tonconnect/ui';
import { ShieldCheck, Wallet, Loader2, CheckCircle2 } from 'lucide-react';

type Props = {
  initData: string;
  onActivated: () => void;
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
};

const MANIFEST = '/api/mining/activation/tonconnect-manifest.json';

export function MiningFeeGate({ initData, onActivated }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [wallet, setWallet] = useState<TonConnectUI | null>(null);
  const [address, setAddress] = useState('');
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
      .then(d => { if (alive) { setStatus(d); if (!d.required) onActivated(); } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'تعذر التحقق'); });
    return () => { alive = false; };
  }, [initData, onActivated]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const connector = new TonConnectUI({ manifestUrl: new URL(MANIFEST, window.location.origin).toString() });
    setWallet(connector);
    const unsubscribe = connector.onStatusChange(w => {
      setAddress(w?.account?.address || '');
    });
    return () => {
      unsubscribe();
      void connector.disconnect();
    };
  }, []);

  async function payAndActivate() {
    if (!wallet || !status?.destination || !address) {
      setError('اربط محفظة TON أولًا.');
      return;
    }
    setBusy(true); setError('');
    try {
      const submitted = await wallet.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        network: '-239',
        messages: [{ address: status.destination, amount: '50000000' }],
      });
      const response = await fetch('/api/mining/activation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ txHash: submitted.boc, walletAddress: address }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'لم يتم التحقق من التحويل');
      onActivated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشلت عملية التفعيل');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <div className="mx-auto max-w-md p-4 text-center text-sm text-slate-400">جارٍ التحقق من حالة تفعيل التعدين…</div>;
  if (!status.required) return null;

  return (
    <div dir="rtl" className="mx-auto flex min-h-[55vh] w-full max-w-md items-center justify-center p-4">
      <div className="w-full overflow-hidden rounded-3xl border border-amber-400/25 bg-gradient-to-br from-[#172235] to-[#090f1b] p-5 shadow-2xl">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-amber-400/15 text-amber-300"><ShieldCheck size={30}/></div>
        <h2 className="text-center text-xl font-black text-white">تفعيل التعدين</h2>
        <p className="mt-3 text-center text-sm leading-7 text-slate-300">{status.message}</p>
        <div className="my-5 rounded-2xl border border-white/10 bg-black/20 p-4 text-center">
          <p className="text-xs text-slate-400">رسوم تفعيل لمرة واحدة</p>
          <p className="mt-1 text-3xl font-black text-amber-300">0.05 TON</p>
          <p className="mt-2 text-[11px] text-slate-500">TON Mainnet · لا تتكرر بعد نجاح التفعيل</p>
        </div>
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-white/5 p-3 text-xs text-slate-300">
          <Wallet size={16} className="shrink-0 text-sky-300"/>
          <span className="break-all font-mono" dir="ltr">{address || 'لم يتم ربط المحفظة بعد'}</span>
          {address && <CheckCircle2 size={16} className="shrink-0 text-emerald-400"/>}
        </div>
        <button onClick={() => wallet?.openModal()} disabled={!wallet || busy} className="w-full rounded-xl border border-sky-400/30 bg-sky-400/10 py-3 font-bold text-sky-200 disabled:opacity-50">ربط محفظة TON</button>
        <button onClick={payAndActivate} disabled={!address || busy || !status.destination} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 py-3 font-black text-slate-950 disabled:opacity-50">
          {busy ? <Loader2 className="animate-spin" size={18}/> : <Wallet size={18}/>} ادفع 0.05 TON وابدأ التعدين
        </button>
        {error && <p className="mt-3 rounded-xl bg-red-400/10 p-3 text-center text-xs text-red-200">{error}</p>}
        {!status.destination && <p className="mt-3 text-center text-xs text-red-300">إعداد محفظة استقبال رسوم التعدين غير مكتمل على الخادم.</p>}
        <p className="mt-4 text-center text-[10px] leading-5 text-slate-500">لن نطلب منك العبارة السرية أو مفاتيح المحفظة. وافق على التحويل من داخل تطبيق المحفظة فقط.</p>
      </div>
    </div>
  );
}
