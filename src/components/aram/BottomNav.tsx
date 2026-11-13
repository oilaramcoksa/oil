'use client';

import { Wallet, ListChecks, Droplet, Users, Store, Dices } from 'lucide-react';
import { motion } from 'framer-motion';
import { t } from '@/lib/i18n';
import { useGame } from '@/lib/store';
import { useTelegram } from '@/hooks/use-telegram';

export type Tab = 'pump' | 'wallet' | 'tasks' | 'friends' | 'store' | 'arena';

interface Props {
  active: Tab;
  onChange: (t: Tab) => void;
}

export function BottomNav({ active, onChange }: Props) {
  const lang = useGame((s) => s.lang);
  const { haptic } = useTelegram();

  const items: { key: Tab; icon: React.ReactNode; label: string }[] = [
    { key: 'arena', icon: <Dices className="w-5 h-5" />, label: t(lang, 'navArena') },
    { key: 'wallet', icon: <Wallet className="w-5 h-5" />, label: t(lang, 'navWallet') },
    { key: 'tasks', icon: <ListChecks className="w-5 h-5" />, label: t(lang, 'navTasks') },
    { key: 'pump', icon: <Droplet className="w-6 h-6" />, label: t(lang, 'navPump') },
    { key: 'friends', icon: <Users className="w-5 h-5" />, label: t(lang, 'navFriends') },
    { key: 'store', icon: <Store className="w-5 h-5" />, label: t(lang, 'navStore') },
  ];

  return (
    <nav className="aram-safe-bottom relative z-30 shrink-0 bg-[#2a1c0a]/95 backdrop-blur-md border-t border-amber-500/20">
      <div className="mx-auto grid min-h-[58px] w-full max-w-md grid-cols-6">
        {items.map((it) => {
          const isActive = active === it.key;
          const isCenter = it.key === 'pump';
          if (isCenter) {
            return (
              <button
                key={it.key}
                onClick={() => { haptic('medium'); onChange(it.key); }}
                className="relative flex flex-col items-center justify-center pt-2 pb-1"
                aria-label={it.label}
              >
                <motion.div
                  whileTap={{ scale: 0.9 }}
                  className={`-mt-6 w-14 h-14 rounded-full flex items-center justify-center shadow-lg border-2 ${
                    isActive
                      ? 'bg-gradient-to-br from-amber-400 to-orange-500 border-amber-200 text-white'
                      : 'bg-gradient-to-br from-amber-500/80 to-orange-600/80 border-amber-300/30 text-white'
                  }`}
                >
                  {it.icon}
                </motion.div>
                <span className={`text-[10px] mt-1 font-bold ${isActive ? 'text-amber-300' : 'text-amber-100/60'}`}>
                  {it.label}
                </span>
              </button>
            );
          }
          return (
            <button
              key={it.key}
              onClick={() => { haptic('light'); onChange(it.key); }}
              className="flex flex-col items-center justify-center py-2 gap-0.5"
              aria-label={it.label}
            >
              <motion.div whileTap={{ scale: 0.85 }} className={isActive ? 'text-amber-300' : 'text-amber-100/60'}>
                {it.icon}
              </motion.div>
              <span className={`text-[10px] font-bold ${isActive ? 'text-amber-300' : 'text-amber-100/60'}`}>
                {it.label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="navdot"
                  className="absolute bottom-1 w-1 h-1 rounded-full bg-amber-300"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
