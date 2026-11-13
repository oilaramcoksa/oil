'use client';

import { Wallet, ListChecks, Droplet, Users, Store, Dices, ArrowLeftRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { t } from '@/lib/i18n';
import { useGame } from '@/lib/store';
import { useTelegram } from '@/hooks/use-telegram';

export type Tab = 'pump' | 'wallet' | 'tasks' | 'friends' | 'store' | 'arena' | 'swap';

interface Props {
  active: Tab;
  onChange: (t: Tab) => void;
}

export function BottomNav({ active, onChange }: Props) {
  const lang = useGame((s) => s.lang);
  const { haptic } = useTelegram();

  // In RTL the grid starts at the right edge. Keep exactly three destinations
  // on either side of the central pump action.
  const items: { key: Tab; icon: React.ReactNode; label: string }[] = [
    { key: 'arena', icon: <Dices className="h-5 w-5" />, label: t(lang, 'navArena') },
    { key: 'swap', icon: <ArrowLeftRight className="h-5 w-5" />, label: t(lang, 'navSwap') },
    { key: 'wallet', icon: <Wallet className="h-5 w-5" />, label: t(lang, 'navWallet') },
    { key: 'pump', icon: <Droplet className="h-7 w-7" />, label: t(lang, 'navPump') },
    { key: 'tasks', icon: <ListChecks className="h-5 w-5" />, label: t(lang, 'navTasks') },
    { key: 'friends', icon: <Users className="h-5 w-5" />, label: t(lang, 'navFriends') },
    { key: 'store', icon: <Store className="h-5 w-5" />, label: t(lang, 'navStore') },
  ];

  return (
    <nav className="aram-safe-bottom relative z-40 shrink-0 border-t border-amber-500/20 bg-gradient-to-b from-[#38240d] to-[#241605] shadow-[0_-8px_28px_rgba(91,48,8,0.18)]">
      <div className="relative mx-auto grid h-[68px] min-h-[68px] w-full max-w-md grid-cols-7 items-end px-1">
        {items.map((it) => {
          const isActive = active === it.key;
          if (it.key === 'pump') {
            return (
              <div key={it.key} className="pointer-events-none h-full" aria-hidden="true" />
            );
          }

          return (
            <button
              key={it.key}
              type="button"
              onClick={() => { haptic('light'); onChange(it.key); }}
              aria-label={it.label}
              aria-current={isActive ? 'page' : undefined}
              className="relative flex h-full min-w-0 flex-col items-center justify-end gap-1 px-0 pb-2 pt-3"
            >
              <motion.span
                whileTap={{ scale: 0.82 }}
                animate={{ y: isActive ? -2 : 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 22 }}
                className={isActive ? 'text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.45)]' : 'text-amber-100/65'}
              >
                {it.icon}
              </motion.span>
              <span className={`max-w-full truncate text-[10px] font-bold leading-none ${isActive ? 'text-amber-300' : 'text-amber-100/65'}`}>
                {it.label}
              </span>
              {isActive && (
                <motion.span
                  layoutId="nav-active-indicator"
                  className="absolute bottom-0 h-[3px] w-7 rounded-t-full bg-amber-300 shadow-[0_0_9px_rgba(251,191,36,0.75)]"
                />
              )}
            </button>
          );
        })}

        <motion.button
          type="button"
          onClick={() => { haptic('medium'); onChange('pump'); }}
          aria-label={t(lang, 'navPump')}
          aria-current={active === 'pump' ? 'page' : undefined}
          whileTap={{ scale: 0.91 }}
          className="absolute left-1/2 top-[-25px] z-20 flex h-[76px] w-[76px] -translate-x-1/2 flex-col items-center justify-center rounded-full border-[3px] border-[#fff0c4] bg-gradient-to-br from-[#ffd45a] via-[#ff9e08] to-[#ed7100] text-white shadow-[0_7px_0_#a94d05,0_12px_24px_rgba(103,52,0,0.38),inset_0_2px_5px_rgba(255,255,255,0.65)]"
        >
          <motion.span
            aria-hidden="true"
            className="absolute inset-[-7px] rounded-full border border-amber-200/70"
            animate={{ scale: [1, 1.1, 1], opacity: [0.65, 0.12, 0.65] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.span
            className="relative flex h-full w-full flex-col items-center justify-center"
            animate={{ y: [0, -2, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Droplet className="h-8 w-8 fill-amber-100/25 drop-shadow-[0_2px_3px_rgba(120,50,0,0.35)]" strokeWidth={2.4} />
            <span className="mt-0.5 text-[10px] font-black leading-none text-[#713500]">{t(lang, 'navPump')}</span>
          </motion.span>
          {active === 'pump' && (
            <motion.span
              layoutId="pump-active-glow"
              className="absolute inset-[-4px] rounded-full border-2 border-white/75"
            />
          )}
        </motion.button>
      </div>
    </nav>
  );
}
