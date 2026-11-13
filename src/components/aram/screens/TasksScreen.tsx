'use client';

import { useState } from 'react';
import { useGame, type TaskState } from '@/lib/store';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Check, Gift, Flame, Calendar, Trophy, Package, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTelegram } from '@/hooks/use-telegram';
import { toast } from 'sonner';

export function TasksScreen() {
  const lang = useGame((s) => s.lang);
  const tasks = useGame((s) => s.tasks);
  const claimTask = useGame((s) => s.claimTask);
  const loginStreak = useGame((s) => s.loginStreak);
  const luckyBoxLastOpened = useGame((s) => s.luckyBoxLastOpened);
  const openLuckyBox = useGame((s) => s.openLuckyBox);
  const { haptic, notify } = useTelegram();
  const [luckyReward, setLuckyReward] = useState<number | null>(null);

  const daily = tasks.filter((t_) => t_.period === 'daily');
  const weekly = tasks.filter((t_) => t_.period === 'weekly');

  // Current ISO week key for lucky box availability check
  const currentWeek = (() => {
    const d = new Date();
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${week}`;
  })();
  const luckyAvailable = luckyBoxLastOpened !== currentWeek;

  const handleOpenLuckyBox = () => {
    haptic('heavy');
    const r = openLuckyBox();
    if (r) {
      setLuckyReward(r.reward);
      notify('success');
      toast.success(`${t(lang, 'luckyBoxReward')} +${r.reward} ${t(lang, 'coins')}!`);
      setTimeout(() => setLuckyReward(null), 3000);
    } else {
      haptic('light');
    }
  };

  const handleClaim = (id: string) => {
    const r = claimTask(id);
    if (r.ok) {
      haptic('heavy');
      notify('success');
    } else {
      haptic('light');
    }
  };

  return (
    <div className="h-full min-h-0 max-w-md mx-auto w-full overflow-y-auto overscroll-contain px-3 pt-2 pb-6 aram-scroll" style={{ maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}>
      {/* Title */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-400 to-fuchsia-500 flex items-center justify-center text-white shadow-lg">
          <Trophy className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-black text-[#2a1c0a]">{t(lang, 'tasksTitle')}</h2>
          <p className="text-[11px] text-amber-900/60 font-bold">{t(lang, 'dailyTasks')} · {t(lang, 'weeklyTasks')}</p>
        </div>
      </div>

      {/* === Login streak (7-day) === */}
      <div className="aram-card rounded-2xl p-3 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <Flame className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-black text-[#2a1c0a]">{t(lang, 'loginStreak')}</span>
          <span className="ml-auto text-[10px] text-amber-900/60 font-bold">
            {t(lang, 'todayReward')}: +{loginStreak || 1}
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => {
            const isCurrent = loginStreak === day;
            const isPast = loginStreak > day;
            return (
              <div
                key={day}
                className={`flex flex-col items-center py-1.5 rounded-lg transition-all ${
                  isCurrent
                    ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg scale-105'
                    : isPast
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-50 text-amber-900/40'
                }`}
              >
                <span className="text-[9px] font-bold uppercase">{t(lang, 'day')}</span>
                <span className="text-xs font-black tabular-nums">{day}</span>
                <span className={`text-[9px] font-bold tabular-nums ${isCurrent ? 'text-white' : isPast ? 'text-emerald-600' : 'text-amber-900/40'}`}>
                  +{day}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-[9px] text-amber-900/50 font-bold text-center mt-2">
          ⓘ {t(lang, 'streakReset')}
        </p>
      </div>

      {/* === Lucky box === */}
      <div className={`aram-card rounded-2xl p-3 mb-3 ${luckyAvailable ? 'border-amber-400 ring-2 ring-amber-400/30' : ''}`}>
        <div className="flex items-center gap-2.5">
          <motion.div
            animate={luckyAvailable ? { rotate: [0, -5, 5, -5, 0] } : {}}
            transition={luckyAvailable ? { duration: 2, repeat: Infinity } : {}}
            className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0 ${
              luckyAvailable
                ? 'bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white'
                : 'bg-amber-100 text-amber-700/50'
            }`}
          >
            <Package className="w-6 h-6" />
          </motion.div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black text-[#2a1c0a]">{t(lang, 'luckyBox')}</div>
            <div className="text-[10px] text-amber-900/60 font-bold">{t(lang, 'luckyBoxDesc')}</div>
            <div className="text-[9px] text-amber-900/50 font-bold mt-0.5">
              {luckyAvailable ? `✨ ${t(lang, 'luckyBoxAvailable')}` : `🔒 ${t(lang, 'luckyBoxOpened')}`}
              · {t(lang, 'oncePerWeek')}
            </div>
          </div>
          <Button
            onClick={handleOpenLuckyBox}
            disabled={!luckyAvailable}
            className={`h-9 px-3 rounded-xl font-black text-xs flex-shrink-0 ${
              luckyAvailable
                ? 'bg-gradient-to-r from-fuchsia-500 to-purple-600 hover:from-fuchsia-600 hover:to-purple-700 text-white shadow-lg'
                : 'bg-amber-100 text-amber-700/40 cursor-not-allowed'
            }`}
          >
            {luckyAvailable ? t(lang, 'openLuckyBox') : '🔒'}
          </Button>
        </div>
        {/* Reward popup */}
        <AnimatePresence>
          {luckyReward !== null && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="mt-2 px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 text-white text-center"
            >
              <Sparkles className="w-4 h-4 inline mr-1" />
              <span className="font-black text-sm">
                {t(lang, 'luckyBoxReward')} +{luckyReward} {t(lang, 'coins')}!
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Daily */}
      <div className="mb-3">
        <div className="flex items-center gap-1.5 mb-2 px-1">
          <Calendar className="w-4 h-4 text-amber-700" />
          <h3 className="text-sm font-black text-[#2a1c0a]">{t(lang, 'dailyTasks')}</h3>
        </div>
        <div className="space-y-2">
          {daily.map((task, i) => (
            <TaskCard key={task.id} task={task} lang={lang} onClaim={handleClaim} delay={i * 0.04} />
          ))}
        </div>
      </div>

      {/* Weekly */}
      <div>
        <div className="flex items-center gap-1.5 mb-2 px-1">
          <Flame className="w-4 h-4 text-orange-600" />
          <h3 className="text-sm font-black text-[#2a1c0a]">{t(lang, 'weeklyTasks')}</h3>
        </div>
        <div className="space-y-2">
          {weekly.map((task, i) => (
            <TaskCard key={task.id} task={task} lang={lang} onClaim={handleClaim} delay={i * 0.04} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  lang,
  onClaim,
  delay,
}: {
  task: TaskState;
  lang: 'ar' | 'en' | 'ru';
  onClaim: (id: string) => void;
  delay: number;
}) {
  const done = task.progress >= task.target;
  const pct = Math.min(100, (task.progress / task.target) * 100);

  const titleKey = {
    login: 'taskLogin',
    taps: 'taskTaps',
    sell: 'taskSell',
    invite: 'taskInvite',
    upgrade: 'taskUpgrade',
    weekTaps: 'taskWeekTaps',
    weekSell: 'taskWeekSell',
    weekInvite: 'taskWeekInvite',
  }[task.kind];
  const descKey = titleKey + 'Desc';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="aram-card rounded-2xl p-3"
    >
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          done ? 'bg-gradient-to-br from-emerald-400 to-teal-500 text-white' : 'bg-amber-100 text-amber-700'
        }`}>
          {task.claimed ? <Check className="w-5 h-5" /> : <Gift className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-black text-[#2a1c0a]">{t(lang, titleKey)}</div>
          <div className="text-[11px] text-amber-900/60 font-bold mb-1.5">{t(lang, descKey)}</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-amber-900/15 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500"
              />
            </div>
            <span className="text-[10px] text-amber-900/60 font-bold tabular-nums">
              {task.progress}/{task.target}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-700 text-xs font-black">
            <span className="text-amber-500">+</span>
            <span className="tabular-nums">{task.reward}</span>
          </div>
          {task.claimed ? (
            <div className="text-[10px] text-emerald-600 font-bold flex items-center gap-0.5">
              <Check className="w-3 h-3" /> {t(lang, 'claimed')}
            </div>
          ) : done ? (
            <Button
              onClick={() => onClaim(task.id)}
              size="sm"
              className="h-6 px-3 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold"
            >
              {t(lang, 'claim')}
            </Button>
          ) : (
            <div className="text-[10px] text-amber-900/40 font-bold">{t(lang, 'progress')}</div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
