'use client';

import { useEffect, useState } from 'react';
import { useGame, type TaskState } from '@/lib/store';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Check, Gift, Flame, Calendar, Trophy, Package, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTelegram } from '@/hooks/use-telegram';
import { toast } from 'sonner';
import { TadsAd } from '@/components/aram/TadsAd';
import { AdsgramRewardAd } from '@/components/aram/AdsgramRewardAd';
import { AdsgramInterstitialAd } from '@/components/aram/AdsgramInterstitialAd';

type AdProgress = { used: number; limit: number; remaining: number; cooldownUntil: number | null; locked: boolean; rewardPerAd: number; totalCycleReward: number };

export function TasksScreen({ initData, isVerified }: { initData: string; isVerified: boolean }) {
  const lang = useGame((s) => s.lang);
  const tasks = useGame((s) => s.tasks);
  const claimTask = useGame((s) => s.claimTask);
  const applyServerAdReward = useGame((s) => s.applyServerAdReward);
  const loginStreak = useGame((s) => s.loginStreak);
  const luckyBoxLastOpened = useGame((s) => s.luckyBoxLastOpened);
  const openLuckyBox = useGame((s) => s.openLuckyBox);
  const { haptic, notify } = useTelegram();
  const [luckyReward, setLuckyReward] = useState<number | null>(null);
  const [adProgress, setAdProgress] = useState<AdProgress | null>(null);
  const [adProgressLoading, setAdProgressLoading] = useState(true);

  useEffect(() => {
    if (!isVerified || !initData) {
      setAdProgress(null);
      setAdProgressLoading(false);
      return;
    }
    let stopped = false;
    const loadProgress = async () => {
      try {
        const response = await fetch('/api/ads/reward', {
          headers: { 'X-Telegram-Init-Data': initData },
          cache: 'no-store',
        });
        if (!response.ok) {
          if (!stopped) setAdProgressLoading(false);
          return;
        }
        const data = await response.json() as AdProgress;
        if (!stopped) {
          setAdProgress(data);
          setAdProgressLoading(false);
        }
      } catch (error) {
        console.error('ad_missions_load_failed', error);
        if (!stopped) setAdProgressLoading(false);
      }
    };
    setAdProgressLoading(true);
    void loadProgress();
    const timer = window.setInterval(() => void loadProgress(), 5000);
    const onFocus = () => void loadProgress();
    window.addEventListener('focus', onFocus);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [initData, isVerified]);

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

      {/* === Rewarded ad cycle: 10 ads, 100 coins each, then 12h cooldown === */}
      <div className="aram-card rounded-2xl p-3 mb-3 border border-amber-300/70">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-[#2a1c0a]">{t(lang, 'adMissionsTitle')}</h3>
              <p className="text-[10px] text-amber-900/60 font-bold">30 إعلانًا كل 12 ساعة · AdsGram: 20 / TADS: 10</p>
            </div>
          </div>
          <span className="text-xs font-black text-amber-800 tabular-nums">{adProgress ? `${adProgress.used}/30` : (adProgressLoading ? '…/30' : '0/30')}</span>
        </div>
        <div className="h-2 rounded-full bg-amber-900/10 overflow-hidden mb-3">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all" style={{ width: `${Math.min(100, (adProgress?.used ?? 0) / 30 * 100)}%` }} />
        </div>
        <div className="flex items-center justify-between rounded-xl bg-amber-50/80 border border-amber-900/5 px-3 py-2 mb-3">
          <span className="text-xs font-black text-[#56351b]">المكافأة لكل إعلان</span>
          <span className="text-sm font-black text-emerald-700">+100 {t(lang, 'coins')}</span>
        </div>
        {isVerified && initData ? (
          <TadsAd
            widgetId={13283}
            mode="fullscreen"
            title={t(lang, 'tadsWatchAdReward')}
            actionLabel={t(lang, 'tadsWatchAdReward')}
            loadingLabel={t(lang, 'tadsRewardLoading')}
            initData={initData}
            isVerified={isVerified}
            onRewarded={(reward, walletCoins) => {
              applyServerAdReward(reward, walletCoins);
              haptic('medium');
              notify('success');
              toast.success(`${t(lang, 'tadsRewardSuccess')} +${reward} ${t(lang, 'coins')}`);
            }}
            onRewardError={(error) => {
              if (error === 'telegram_auth_required') toast.error(t(lang, 'telegramRequired'));
              else if (error === 'ad_cycle_cooldown' || error === 'ad_cycle_limit_reached') toast.error('اكتملت مشاهدات الدورة. انتظر انتهاء العداد.');
              else if (error !== 'no_ad_available' && error !== 'ad_timeout') toast.error(t(lang, 'tadsUnavailable'));
            }}
          />
        ) : (
          <p className="text-center text-xs font-bold text-amber-900/60">{t(lang, 'telegramRequired')}</p>
        )}
        {isVerified && initData && (
          <AdsgramRewardAd
            initData={initData}
            isVerified={isVerified}
            onRewarded={(reward, walletCoins) => {
              applyServerAdReward(reward, walletCoins);
              haptic('medium');
              notify('success');
              toast.success(`${t(lang, 'tadsRewardSuccess')} +${reward} ${t(lang, 'coins')}`);
            }}
            onRewardError={(error) => {
              if (error === 'telegram_auth_required') toast.error(t(lang, 'telegramRequired'));
              else if (error === 'ad_cycle_cooldown' || error === 'ad_cycle_limit_reached') toast.error('اكتملت مشاهدات الدورة. انتظر انتهاء العداد.');
              else if (error === 'adsgram_not_completed') toast.info('لم تكتمل مشاهدة الإعلان، لذلك لم تُضف مكافأة.');
              else toast.error('تعذر تشغيل إعلان AdsGram. حاول لاحقًا.');
            }}
          />
        )}
        {isVerified && initData && (
          <AdsgramInterstitialAd
            initData={initData}
            isVerified={isVerified}
            onRewarded={(reward, walletCoins) => {
              applyServerAdReward(reward, walletCoins);
              haptic('medium');
              notify('success');
              toast.success(`مكافأة إعلان Interstitial: +${reward} ${t(lang, 'coins')}`);
            }}
            onRewardError={(error) => {
              if (error === 'telegram_auth_required') toast.error(t(lang, 'telegramRequired'));
              else if (error === 'adsgram_interstitial_not_completed') toast.info('لم يكتمل الإعلان، ولم تُضف المكافأة.');
              else toast.error('تعذر تشغيل إعلان Interstitial. حاول لاحقًا.');
            }}
          />
        )}
        <p className="mt-2 text-center text-[10px] font-bold text-amber-900/60">
          {adProgress?.locked ? 'اكتملت 30/30 مشاهدة، وسيُعاد تفعيل المشاهدة بعد انتهاء 12 ساعة.' : `المتبقي: ${adProgress?.remaining ?? 30} إعلانًا · المكافأة: Reward/Task 100 وInterstitial 50`}
        </p>
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
