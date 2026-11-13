'use client';

import { useGame } from '@/lib/store';
import { t } from '@/lib/i18n';
import { Coins, Droplet, Gauge, History, ArrowDownRight, ArrowUpRight, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { WithdrawSection } from '@/components/aram/WithdrawSection';
import { effectiveSpeed, effectiveOilPerTap, effectiveCapacity, effectiveCoinsPerHour } from '@/lib/store';

export function WalletScreen() {
  const lang = useGame((s) => s.lang);
  const coins = useGame((s) => s.coins);
  const oil = useGame((s) => s.oil);
  const upgrades = useGame((s) => s.upgrades);
  const transactions = useGame((s) => s.transactions);

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

function timeAgo(ts: number, lang: 'ar' | 'en' | 'ru'): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days} ${t(lang, 'daysAgo')}`;
  if (hours > 0) return `${hours} ${t(lang, 'hoursAgo')}`;
  if (mins > 0) return `${mins} ${t(lang, 'minutesAgo')}`;
  return t(lang, 'today');
}
