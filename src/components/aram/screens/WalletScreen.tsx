'use client';

import { useEffect, useState } from 'react';
import { useGame } from '@/lib/store';
import { t, type Lang } from '@/lib/i18n';
import { Coins, Droplet, Gauge, History, ArrowDownRight, ArrowUpRight, Clock, WalletCards, RefreshCw, Link2, Unlink } from 'lucide-react';
import { motion } from 'framer-motion';
import { WithdrawSection } from '@/components/aram/WithdrawSection';
import { effectiveSpeed, effectiveOilPerTap, effectiveCapacity, effectiveCoinsPerHour } from '@/lib/store';
import { getTonConnectUI } from '@/lib/ton-connect';

export function WalletScreen() {
  const lang = useGame((s) => s.lang);
  const coins = useGame((s) => s.coins);
  const oil = useGame((s) => s.oil);
  const upgrades = useGame((s) => s.upgrades);
  const transactions = useGame((s) => s.transactions);
  const tonAddress = useGame((s) => s.tonAddress);
  const [tonConnector, setTonConnector] = useState<import('@tonconnect/ui').TonConnectUI | null>(null);
  const [tonConnected, setTonConnected] = useState(false);
  const [tonBalance, setTonBalance] = useState<string | null>(null);
  const [tonBalanceLoading, setTonBalanceLoading] = useState(false);
  const [tonWalletError, setTonWalletError] = useState(false);

  // TON Connect keeps the approved session in its own persistent storage.
  // Keep the public wallet address in the game's persisted Zustand state too.
  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    let connector: import('@tonconnect/ui').TonConnectUI | null = null;
    void getTonConnectUI().then((instance) => {
      if (!alive) return;
      connector = instance;
      setTonConnector(connector);
      setTonConnected(Boolean(connector.connected));
      const restoredAddress = connector.account?.address ?? '';
      if (restoredAddress) useGame.setState({ tonAddress: restoredAddress });
      unsubscribe = connector.onStatusChange((account) => {
        if (!alive) return;
        const address = account?.account?.address ?? '';
        setTonConnected(Boolean(address));
        useGame.setState({ tonAddress: address });
        setTonWalletError(false);
      });
    }).catch((error) => {
      console.error('wallet_tonconnect_init_failed', error);
      if (alive) setTonWalletError(true);
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!tonAddress) {
      setTonBalance(null);
      return;
    }
    let alive = true;
    let controller: AbortController | null = null;
    const refreshBalance = async () => {
      controller?.abort();
      controller = new AbortController();
      setTonBalanceLoading(true);
      try {
        const url = new URL('https://toncenter.com/api/v2/getAddressBalance');
        url.searchParams.set('address', tonAddress);
        const headers: Record<string, string> = {};
        if (process.env.NEXT_PUBLIC_TONCENTER_API_KEY) {
          headers['X-API-Key'] = process.env.NEXT_PUBLIC_TONCENTER_API_KEY;
        }
        const response = await fetch(url.toString(), {
          headers, cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error('ton_balance_request_failed');
        const data = await response.json() as { ok?: boolean; result?: string };
        if (data.ok !== true || !/^\d+$/.test(String(data.result ?? ''))) {
          throw new Error('ton_balance_response_invalid');
        }
        const ton = Number(data.result) / 1_000_000_000;
        if (alive && Number.isFinite(ton)) setTonBalance(ton.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
      } catch (error) {
        if (alive && !(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('ton_wallet_balance_refresh_failed', error);
          setTonBalance(null);
        }
      } finally {
        if (alive) setTonBalanceLoading(false);
      }
    };
    void refreshBalance();
    const interval = window.setInterval(() => { void refreshBalance(); }, 30000);
    return () => {
      alive = false;
      controller?.abort();
      window.clearInterval(interval);
    };
  }, [tonAddress]);

  const connectTonWallet = async () => {
    if (!tonConnector) return;
    try {
      await tonConnector.openModal();
    } catch (error) {
      console.error('ton_wallet_connect_failed', error);
      setTonWalletError(true);
    }
  };

  const disconnectTonWallet = async () => {
    if (!tonConnector) return;
    try {
      await tonConnector.disconnect();
      useGame.setState({ tonAddress: '' });
      setTonBalance(null);
      setTonConnected(false);
    } catch (error) {
      console.error('ton_wallet_disconnect_failed', error);
    }
  };

  const speed = effectiveSpeed(upgrades);
  const perTap = effectiveOilPerTap(upgrades);
  const coinsPerHour = effectiveCoinsPerHour(upgrades);
  const cap = effectiveCapacity(upgrades);

  const stats = [
    { icon: <Coins className="w-5 h-5" />, label: t(lang, 'gameCoins'), value: coins.toLocaleString(), color: 'from-amber-400 to-orange-500' },
    { icon: <Droplet className="w-5 h-5" />, label: t(lang, 'oilDrops'), value: `${oil.toFixed(0)} / ${cap}`, color: 'from-emerald-400 to-teal-500' },
    { icon: <Gauge className="w-5 h-5" />, label: t(lang, 'speedLevel'), value: speed.toLocaleString(), color: 'from-purple-400 to-fuchsia-500' },
    { icon: <Clock className="w-5 h-5" />, label: t(lang, 'coinsPerHour'), value: `+${coinsPerHour}`, color: 'from-sky-400 to-blue-500' },
  ];

  return (
    <div className="h-full min-h-0 max-w-md mx-auto w-full overflow-y-auto overscroll-contain px-3 pt-2 pb-6 aram-scroll" style={{ maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}>
      {/* Title */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-lg">
          <Coins className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-black text-[#2a1c0a]">{t(lang, 'walletTitle')}</h2>
          <p className="text-[11px] text-amber-900/60 font-bold">{t(lang, 'internalBalance')}</p>
        </div>
      </div>

      {/* Big balance card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="aram-card-dark rounded-3xl p-5 mb-3"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-amber-200/70 text-xs font-bold uppercase">{t(lang, 'gameCoins')}</span>
          <Coins className="w-5 h-5 text-amber-400" />
        </div>
        <div className="text-4xl font-black text-amber-300 tabular-nums">
          {coins.toLocaleString()}
        </div>
        <div className="mt-3 pt-3 border-t border-amber-500/20 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-amber-200/60 font-bold uppercase">{t(lang, 'oilDrops')}</div>
            <div className="text-amber-100 font-bold text-sm tabular-nums">{oil.toFixed(0)} / {cap}</div>
          </div>
          <div>
            <div className="text-[10px] text-amber-200/60 font-bold uppercase">{t(lang, 'speedLevel')}</div>
            <div className="text-amber-100 font-bold text-sm tabular-nums">{speed.toLocaleString()}</div>
          </div>
        </div>
        <div className="mt-3 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <p className="text-[10px] text-amber-200/80 font-bold leading-relaxed">
            ⓘ {t(lang, 'aboutText').split('.')[0]}.
          </p>
        </div>
      </motion.div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {stats.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="aram-card rounded-2xl p-3"
          >
            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${s.color} flex items-center justify-center text-white mb-2`}>
              {s.icon}
            </div>
            <div className="text-[10px] text-amber-900/60 font-bold uppercase">{s.label}</div>
            <div className="text-sm font-black text-[#2a1c0a] tabular-nums">{s.value}</div>
          </motion.div>
        ))}
      </div>

      {/* Persistent TON wallet */}
      <motion.section
        initial={{ opacity: 0, y: 12, rotateX: -5 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 0.45 }}
        className="relative overflow-hidden rounded-3xl border border-cyan-300/30 bg-gradient-to-br from-[#102b3a] via-[#123d50] to-[#071a2b] p-4 mb-3 text-white shadow-[0_18px_40px_rgba(7,26,43,0.28)]"
        style={{ perspective: 900 }}
      >
        <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-cyan-300/15 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-12 left-8 h-32 w-32 rounded-full bg-blue-400/15 blur-2xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <motion.div
              animate={{ y: [0, -4, 0], rotateY: [0, 12, 0], rotateZ: [0, -3, 0] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-cyan-100/30 bg-gradient-to-br from-cyan-300 via-sky-500 to-blue-800 text-white shadow-[0_10px_22px_rgba(0,0,0,0.4),inset_0_2px_5px_rgba(255,255,255,0.45)]"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <div className="absolute inset-1 rounded-xl border border-white/20" />
              <WalletCards className="h-8 w-8 drop-shadow-[0_3px_3px_rgba(0,0,0,0.5)]" />
              <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-[#123d50] bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
            </motion.div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-white">{t(lang, 'tonWalletTitle')}</h3>
              <p className="mt-0.5 text-[10px] font-bold text-cyan-100/65">{t(lang, tonConnected ? 'tonWalletConnected' : 'tonWalletSaved')}</p>
              {tonAddress ? (
                <p className="mt-1 truncate font-mono text-[10px] text-cyan-100/80" dir="ltr">
                  {tonAddress.slice(0, 8)}…{tonAddress.slice(-7)}
                </p>
              ) : null}
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-cyan-100/20 bg-white/10 px-2 py-1 text-[9px] font-black tracking-wide text-cyan-100">TON</span>
        </div>

        <div className="relative mt-4 rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
          <div className="text-[10px] font-bold text-cyan-100/65">{t(lang, 'tonWalletBalance')}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <motion.span key={tonBalance ?? 'empty'} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-3xl font-black tabular-nums text-white">
              {tonBalance ?? (tonAddress ? '—' : '0.00')}
            </motion.span>
            <span className="text-sm font-black text-cyan-200">TON</span>
            {tonBalanceLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-200/70" />}
          </div>
          <p className="mt-1 text-[9px] text-cyan-100/50">{t(lang, 'tonWalletAutoRefresh')}</p>
        </div>

        {tonWalletError && <p className="relative mt-2 text-[10px] font-bold text-amber-200">{t(lang, 'tonWalletConnectError')}</p>}
        {tonAddress ? (
          <div className="relative mt-3 flex gap-2">
            <button onClick={() => { if (tonAddress) void navigator.clipboard?.writeText(tonAddress); }} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-cyan-100/20 bg-white/10 px-3 py-2.5 text-xs font-black text-white">
              <Link2 className="h-4 w-4" /> {t(lang, 'tonWalletAddress')}
            </button>
            <button onClick={disconnectTonWallet} className="flex items-center justify-center gap-2 rounded-xl border border-rose-200/20 bg-rose-500/10 px-3 py-2.5 text-xs font-black text-rose-100">
              <Unlink className="h-4 w-4" /> {t(lang, 'tonWalletDisconnect')}
            </button>
          </div>
        ) : (
          <button onClick={connectTonWallet} disabled={!tonConnector} className="relative mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-100/20 bg-gradient-to-r from-cyan-500 to-blue-600 px-3 py-3 text-xs font-black text-white shadow-lg disabled:opacity-50">
            <WalletCards className="h-4 w-4" /> {t(lang, 'tonWalletConnect')}
          </button>
        )}
      </motion.section>

      {/* Withdraw (TON) */}
      <WithdrawSection />

      {/* Transactions */}
      <div className="aram-card rounded-2xl p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <History className="w-4 h-4 text-amber-700" />
            <h3 className="text-sm font-black text-[#2a1c0a]">{t(lang, 'transactions')}</h3>
          </div>
        </div>
        {transactions.length === 0 ? (
          <div className="text-center py-6 text-amber-900/50 text-xs font-bold">
            {t(lang, 'noTransactions')}
          </div>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto aram-scroll">
            {transactions.slice(0, 20).map((tx) => {
              const positive = tx.amount >= 0;
              const isUpgrade = tx.type === 'upgrade';
              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-amber-50/50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                      positive ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'
                    }`}>
                      {positive ? <ArrowDownRight className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#2a1c0a] truncate">
                        {t(lang, tx.label)}
                      </div>
                      <div className="text-[10px] text-amber-900/50">
                        {timeAgo(tx.createdAt, lang)}
                      </div>
                    </div>
                  </div>
                  <div className={`text-sm font-black tabular-nums flex-shrink-0 ${
                    isUpgrade ? 'text-purple-600' : positive ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {positive && !isUpgrade ? '+' : isUpgrade ? '' : ''}
                    {tx.amount >= 0 && !isUpgrade ? tx.amount.toLocaleString() : isUpgrade ? `$${Math.abs(tx.amount)}` : tx.amount.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function timeAgo(ts: number, lang: Lang): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days} ${t(lang, 'daysAgo')}`;
  if (hours > 0) return `${hours} ${t(lang, 'hoursAgo')}`;
  if (mins > 0) return `${mins} ${t(lang, 'minutesAgo')}`;
  return t(lang, 'today');
}
