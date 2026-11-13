'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ArrowDownToLine, Coins, DollarSign, RefreshCw, Wallet, ClipboardPaste } from 'lucide-react';
import { toast } from 'sonner';
import { useGame } from '@/lib/store';
import { t } from '@/lib/i18n';

type Withdrawal = { id: string; usdMicros: number; tronAddress: string; status: 'pending'|'paid'|'rejected'; txHash: string|null; adminNote: string|null; createdAt: number; updatedAt: number };
type WalletData = { coins: number; usdMicros: number; usdLockedMicros?: number };
const fmtUsd = (micros: number) => (micros / 1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';

export function SwapScreen({ initData, isVerified }: { initData: string; isVerified: boolean }) {
  const lang = useGame((s) => s.lang);
  const [wallet, setWallet] = useState<WalletData>({ coins: 0, usdMicros: 0 });
  const [history, setHistory] = useState<Withdrawal[]>([]);
  const [coinsInput, setCoinsInput] = useState('');
  const [usdInput, setUsdInput] = useState('1');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState(false);
  const [busy, setBusy] = useState(false);
  const headers = useMemo(() => ({ 'X-Telegram-Init-Data': initData }), [initData]);
  const refresh = useCallback(async () => {
    if (!isVerified || !initData) { setWalletLoading(false); setWalletError(true); return; }
    try {
      const res = await fetch('/api/usdt-withdrawals', { headers, cache: 'no-store' });
      if (!res.ok) throw new Error('wallet_load_failed');
      const data = await res.json();
      if (!data.wallet || !Number.isSafeInteger(Number(data.wallet.coins)) || !Number.isSafeInteger(Number(data.wallet.usdMicros))) throw new Error('wallet_data_invalid');
      setWallet({ coins: Number(data.wallet.coins), usdMicros: Number(data.wallet.usdMicros), usdLockedMicros: Number(data.wallet.usdLockedMicros ?? 0) });
      setHistory(data.withdrawals ?? []);
      setWalletError(false);
    } catch (error) {
      console.error('swap_wallet_load_failed', error);
      setWalletError(true);
    } finally { setWalletLoading(false); }
  }, [headers, initData, isVerified]);
  useEffect(() => { void refresh(); const id = window.setInterval(() => void refresh(), 20000); return () => window.clearInterval(id); }, [refresh]);

  const coinsAmount = Math.max(0, Math.floor(Number(coinsInput) || 0));
  const convertedMicros = coinsAmount * 10;
  const usdAmount = Math.round(Number(usdInput) * 1_000_000);
  const canSwap = coinsAmount > 0 && coinsAmount <= wallet.coins && Number.isSafeInteger(convertedMicros) && !busy;
  const tronValid = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address.trim());
  const canWithdraw = Number.isSafeInteger(usdAmount) && usdAmount >= 1_000_000 && usdAmount <= wallet.usdMicros && tronValid && !loading;

  async function swap() {
    if (!canSwap) return;
    setBusy(true);
    try {
      const res = await fetch('/api/swap', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ coins: coinsAmount, idempotencyKey: crypto.randomUUID() }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'server_error');
      setWallet((old) => ({ ...old, ...data.wallet }));
      setCoinsInput('');
      toast.success(t(lang, 'swapSuccess'));
      await refresh();
    } catch { toast.error(t(lang, 'swapError')); }
    finally { setBusy(false); }
  }

  async function withdraw() {
    if (!canWithdraw) return;
    setLoading(true);
    try {
      const res = await fetch('/api/usdt-withdrawals', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ amountUsd: usdAmount / 1_000_000, tronAddress: address.trim(), idempotencyKey: crypto.randomUUID() }) });
      const data = await res.json();
      if (!res.ok) {
        const key = data.error === 'insufficient_usd_balance' ? 'swapInsufficientUsd' : data.error === 'invalid_tron_address' ? 'swapInvalidAddress' : data.error === 'minimum_one_usd' ? 'swapMinWithdrawError' : 'swapWithdrawError';
        throw new Error(key);
      }
      setWallet((old) => ({ ...old, ...data.wallet }));
      setUsdInput('1');
      toast.success(t(lang, 'swapWithdrawQueued'));
      await refresh();
    } catch (e) { toast.error(t(lang, e instanceof Error && e.message.startsWith('swap') ? e.message : 'swapWithdrawError')); }
    finally { setLoading(false); }
  }
  const statusLabel = (status: Withdrawal['status']) => status === 'paid' ? t(lang, 'swapPaid') : status === 'rejected' ? t(lang, 'swapRejected') : t(lang, 'swapPending');

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto overscroll-contain px-3 pt-3 pb-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="mx-auto w-full max-w-md space-y-3">
        <header className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg"><ArrowLeftRight size={22}/></div>
          <div><h2 className="text-xl font-black text-[#542b12]">{t(lang, 'swapTitle')}</h2><p className="text-xs font-bold text-amber-900/60">{t(lang, 'swapRate')}</p></div>
        </header>
        <section className="aram-card rounded-2xl p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between"><h3 className="font-black text-[#633715]">{t(lang, 'swapConvert')}</h3><span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">100,000 = $1</span></div>
          <label className="mb-1 block text-xs font-bold text-amber-900/70">{t(lang, 'swapCoinsInput')}</label>
          <div className="flex gap-2"><input inputMode="numeric" type="number" min="1" step="1" value={coinsInput} onChange={(e) => setCoinsInput(e.target.value)} placeholder="100000" className="min-w-0 flex-1 rounded-xl border border-amber-200 bg-white px-3 py-3 text-lg font-black text-[#542b12] outline-none focus:border-amber-500"/><button type="button" onClick={() => setCoinsInput(String(wallet.coins))} className="rounded-xl bg-amber-100 px-3 text-xs font-black text-amber-900">{t(lang, 'swapMax')}</button></div>
          <div className="my-3 flex items-center justify-center gap-2 text-amber-700"><ArrowDownToLine size={16}/><span className="text-xs font-bold">{t(lang, 'swapYouReceive')}</span></div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3"><div className="text-[10px] font-bold text-emerald-800">{t(lang, 'swapDollar')}</div><div className="text-2xl font-black tabular-nums text-emerald-800">$ {fmtUsd(convertedMicros)}</div></div>
          <button disabled={!canSwap || walletLoading || walletError} onClick={() => void swap()} className="mt-3 w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 py-3 font-black text-white shadow-md disabled:opacity-40">{busy ? t(lang, 'swapProcessing') : t(lang, 'swapButton')}</button>
        </section>
        {walletError && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs font-bold text-red-800">{t(lang, 'swapWalletLoadError')}</div>}
        <section className="grid grid-cols-2 gap-2">
          <div className="aram-card rounded-2xl p-3"><div className="mb-2 flex items-center gap-2 text-amber-800"><Coins size={17}/><span className="text-xs font-bold">{t(lang, 'swapOilCoins')}</span></div><div className="break-all text-xl font-black tabular-nums text-[#633715]">{walletLoading ? t(lang, 'swapProcessing') : wallet.coins.toLocaleString()}</div></div>
          <div className="aram-card rounded-2xl p-3"><div className="mb-2 flex items-center gap-2 text-emerald-700"><DollarSign size={17}/><span className="text-xs font-bold">{t(lang, 'swapDollar')}</span></div><div className="break-all text-xl font-black tabular-nums text-emerald-800">$ {walletLoading ? '—' : fmtUsd(wallet.usdMicros)}</div></div>
        </section>
        <section className="aram-card rounded-2xl p-3">
          <div className="mb-3 flex items-center gap-2"><div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><Wallet size={18}/></div><div><h3 className="font-black text-[#633715]">{t(lang, 'swapWithdraw')}</h3><p className="text-[10px] font-bold text-amber-900/60">{t(lang, 'swapUsdtNetwork')}</p></div></div>
          <label className="mb-1 block text-xs font-bold text-amber-900/70">{t(lang, 'swapAmountUsd')}</label>
          <input type="number" inputMode="decimal" min="1" step="0.000001" value={usdInput} onChange={(e) => setUsdInput(e.target.value)} className="mb-3 w-full rounded-xl border border-amber-200 bg-white px-3 py-3 font-bold text-[#542b12] outline-none focus:border-amber-500"/>
          <label className="mb-1 block text-xs font-bold text-amber-900/70">{t(lang, 'swapTronAddress')}</label>
          <div className="flex gap-2" dir="ltr">
            <input type="text" dir="ltr" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="T..." className="min-w-0 flex-1 rounded-xl border border-amber-200 bg-white px-3 py-3 font-mono text-sm text-[#542b12] outline-none focus:border-amber-500"/>
            <button type="button" onClick={async () => {
              try {
                const pasted = await navigator.clipboard.readText();
                if (!pasted.trim()) { toast.error(t(lang, 'swapClipboardEmpty')); return; }
                setAddress(pasted.trim());
                toast.success(t(lang, 'swapPasted'));
              } catch {
                toast.error(t(lang, 'swapPasteDenied'));
              }
            }} className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-100 px-3 text-xs font-black text-amber-900" aria-label={t(lang, 'swapPaste')}>
              <ClipboardPaste size={16}/><span>{t(lang, 'swapPaste')}</span>
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-amber-900/60">{t(lang, 'swapMinWithdrawHint')}</p>
          <button disabled={!canWithdraw || walletLoading || walletError} onClick={() => void withdraw()} className="mt-3 w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3 font-black text-white shadow-md disabled:opacity-40">{loading ? t(lang, 'swapProcessing') : t(lang, 'swapWithdrawButton')}</button>
        </section>
        <section className="aram-card rounded-2xl p-3">
          <div className="mb-3 flex items-center justify-between"><h3 className="font-black text-[#633715]">{t(lang, 'swapHistory')}</h3><RefreshCw size={15} className="text-amber-700"/></div>
          {history.length === 0 ? <p className="py-4 text-center text-xs text-amber-900/50">{t(lang, 'swapNoHistory')}</p> : <div className="space-y-2">
            {history.map((item) => <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl bg-amber-50/80 p-2.5">
              <div className="min-w-0"><div className="font-black text-[#633715]">$ {fmtUsd(item.usdMicros)}</div><div className="truncate text-[10px] text-amber-900/60">{item.tronAddress}</div><div className="text-[10px] text-amber-900/50">{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}</div></div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${item.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : item.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{statusLabel(item.status)}</span>
            </div>)}
          </div>}
        </section>
      </div>
    </div>
  );
}
