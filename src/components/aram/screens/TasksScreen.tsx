'use client';

import { useEffect, useState } from 'react';
import { useGame, type TaskState } from '@/lib/store';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Check, Gift, Flame, Calendar, Trophy, Package, Sparkles, Send, Users, Camera, ExternalLink, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTelegram } from '@/hooks/use-telegram';
import { toast } from 'sonner';
import { HybridRewardedAd } from '@/components/aram/HybridRewardedAd';

type AdProgress = { used: number; limit: number; remaining: number; cooldownUntil: number | null; locked: boolean; rewardPerAd: number; totalCycleReward: number };

export function TasksScreen({ initData, isVerified }: { initData: string; isVerified: boolean }) {
  const lang = useGame((s) => s.lang);
  const tasks = useGame((s) => s.tasks);
  const claimTask = useGame((s) => s.claimTask);
  const applyServerTaskReward = useGame((s) => s.applyServerTaskReward);
  const syncServerWalletCoins = useGame((s) => s.syncServerWalletCoins);
  const loginStreak = useGame((s) => s.loginStreak);
  const luckyBoxLastOpened = useGame((s) => s.luckyBoxLastOpened);
  const openLuckyBox = useGame((s) => s.openLuckyBox);
  const { haptic, notify, tg } = useTelegram();
  const [luckyReward, setLuckyReward] = useState<number | null>(null);
  const [adProgress, setAdProgress] = useState<AdProgress | null>(null);
  const [adProgressLoading, setAdProgressLoading] = useState(true);
  const [telegramClaims, setTelegramClaims] = useState({ channel: false, group: false });
  const [telegramJoined, setTelegramJoined] = useState({ channel: false, group: false });
  const [awaitingTelegramTask, setAwaitingTelegramTask] = useState<'channel' | 'group' | null>(null);
  const [telegramTaskLoading, setTelegramTaskLoading] = useState<'channel' | 'group' | null>(null);
  const [storyUrl, setStoryUrl] = useState('');
  const [storyInfo, setStoryInfo] = useState<{ canSubmit: boolean; pending: { story_url: string; submitted_at: string } | null; latest: { status: string; review_reason?: string | null } | null; nextAllowedAt: number | null } | null>(null);
  const [storyLoading, setStoryLoading] = useState(false);
  const [storySubmitting, setStorySubmitting] = useState(false);

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

  useEffect(() => {
    if (!isVerified || !initData) return;
    let stopped = false;
    const refreshMembership = async () => {
      try {
        const response = await fetch('/api/tasks/telegram-membership', {
          headers: { 'X-Telegram-Init-Data': initData },
          cache: 'no-store',
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!stopped) {
          if (data.claimed) setTelegramClaims(data.claimed);
          if (data.joined) setTelegramJoined(data.joined);
          if (typeof data.walletCoins === 'number') syncServerWalletCoins(data.walletCoins);
          if (data.joined?.[awaitingTelegramTask ?? 'channel']) setAwaitingTelegramTask(null);
          if (data.revoked?.channel || data.revoked?.group) {
            toast.error(lang === 'ar' ? 'تم إلغاء مكافأة المهمة لترك القناة أو الجروب، وتم خصم العملات المتاحة.' : 'Membership ended. Available reward coins were deducted.');
          }
        }
      } catch (error) {
        console.error('telegram_task_status_failed', error);
      }
    };
    void refreshMembership();
    const onFocus = () => void refreshMembership();
    window.addEventListener('focus', onFocus);
    const timer = awaitingTelegramTask ? window.setInterval(() => void refreshMembership(), 5000) : null;
    const tenHourTimer = window.setInterval(() => void refreshMembership(), 10 * 60 * 60 * 1000);
    return () => {
      stopped = true;
      window.removeEventListener('focus', onFocus);
      if (timer) window.clearInterval(timer);
      window.clearInterval(tenHourTimer);
    };
  }, [initData, isVerified, awaitingTelegramTask, lang, syncServerWalletCoins]);

  const refreshStoryTask = async () => {
    if (!initData || !isVerified) return;
    try {
      const response = await fetch('/api/tasks/story', {
        headers: { 'X-Telegram-Init-Data': initData },
        cache: 'no-store',
      });
      if (response.ok) setStoryInfo(await response.json());
    } catch (error) {
      console.error('telegram_story_status_failed', error);
    }
  };

  useEffect(() => {
    if (!isVerified || !initData) return;
    void refreshStoryTask();
    const onFocus = () => void refreshStoryTask();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [initData, isVerified]);

  const openStoryComposer = () => {
    if (!tg?.shareToStory) {
      toast.error(lang === 'ar' ? 'افتح اللعبة من تطبيق تيليجرام لاستخدام نشر الحالة.' : 'Open the game inside Telegram to share a Story.');
      return;
    }
    const mediaUrl = `${window.location.origin}/story.png`;
    try {
      tg.shareToStory(mediaUrl, {
        text: 'Mine with ARMCO OIL! Join the official bot',
        widget_link: { url: 'https://t.me/armcooilbot', name: 'ARMCO OIL' },
      });
    } catch {
      toast.error(lang === 'ar' ? 'تعذر فتح محرر حالة تيليجرام.' : 'Could not open Telegram Story editor.');
    }
  };

  const submitStoryLink = async () => {
    if (!initData || !storyUrl.trim() || storySubmitting) return;
    setStorySubmitting(true);
    setStoryLoading(true);
    try {
      const response = await fetch('/api/tasks/story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
        body: JSON.stringify({ storyUrl: storyUrl.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error === 'story_review_pending') toast.error(lang === 'ar' ? 'لديك مشاركة قيد المراجعة بالفعل.' : 'You already have a submission under review.');
        else if (data.error === 'story_cooldown') toast.error(lang === 'ar' ? 'يمكنك إرسال مشاركة جديدة بعد انتهاء 24 ساعة من آخر موافقة.' : 'Wait 24 hours after your last approval.');
        else if (data.error === 'invalid_story_link') toast.error(lang === 'ar' ? 'أدخل رابط الحالة العامة من تيليجرام، ويجب أن يحتوي على /s/.' : 'Enter a public Telegram Story link containing /s/.');
        else toast.error(lang === 'ar' ? 'تعذر إرسال الرابط للمراجعة.' : 'Could not submit the Story link.');
        return;
      }
      setStoryUrl('');
      toast.success(lang === 'ar' ? 'تم إرسال رابط الحالة إلى الإدارة للمراجعة.' : 'Story link sent to admin for review.');
      await refreshStoryTask();
    } catch {
      toast.error(lang === 'ar' ? 'تعذر الاتصال بالخادم.' : 'Server connection failed.');
    } finally {
      setStorySubmitting(false);
      setStoryLoading(false);
    }
  };

  const claimTelegramTask = async (taskId: 'channel' | 'group') => {
    if (!initData || telegramTaskLoading) return;
    setTelegramTaskLoading(taskId);
    try {
      const response = await fetch('/api/tasks/telegram-membership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
        body: JSON.stringify({ taskId }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error === 'telegram_membership_required') toast.error(lang === 'ar' ? 'انضم أولاً ثم اضغط تحقق.' : lang === 'ru' ? 'Сначала вступите, затем проверьте.' : 'Join first, then verify.');
        else if (data.error === 'telegram_bot_not_configured') toast.error('Telegram bot is not configured on the server.');
        else toast.error(lang === 'ar' ? 'تعذر التحقق الآن. حاول مرة أخرى.' : 'Could not verify right now. Try again.');
        return;
      }
      setTelegramClaims((old) => ({ ...old, [taskId]: true }));
      if (!data.alreadyClaimed && typeof data.walletCoins === 'number') {
        applyServerTaskReward(data.reward, data.walletCoins, taskId);
        toast.success(`+${data.reward} ${t(lang, 'coins')}`);
        haptic('heavy');
        notify('success');
      } else {
        toast.success(lang === 'ar' ? 'المهمة مكتملة بالفعل.' : 'Task already completed.');
      }
    } catch {
      toast.error(lang === 'ar' ? 'تعذر الاتصال بالخادم.' : 'Server connection failed.');
    } finally {
      setTelegramTaskLoading(null);
    }
  };

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

      {/* === Alternating Adexium / TADS rewarded ads === */}
      <div className="aram-card rounded-2xl p-3 mb-3 border border-amber-300/70">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-[#2a1c0a]">{t(lang, 'adMissionsTitle')}</h3>
              <p className="text-[10px] text-amber-900/60 font-bold">{t(lang, 'hybridAdCycleDescription')}</p>
            </div>
          </div>
          <span className="text-xs font-black text-amber-800 tabular-nums">{adProgress ? `${adProgress.used}/30` : (adProgressLoading ? '…/30' : '0/30')}</span>
        </div>
        <div className="h-2 rounded-full bg-amber-900/10 overflow-hidden mb-3">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all" style={{ width: `${Math.min(100, (adProgress?.used ?? 0) / 30 * 100)}%` }} />
        </div>
        <div className="flex items-center justify-between rounded-xl bg-amber-50/80 border border-amber-900/5 px-3 py-2 mb-3">
          <span className="text-xs font-black text-[#56351b]">{t(lang, 'rewardPerAdLabel')}</span>
          <span className="text-sm font-black text-emerald-700">+100 {t(lang, 'coins')}</span>
        </div>
        {isVerified && initData ? (
          <HybridRewardedAd
            initData={initData}
            isVerified={isVerified}
            title={t(lang, 'tadsWatchAdReward')}
            actionLabel={t(lang, 'tadsWatchAdReward')}
            loadingLabel={t(lang, 'tadsRewardLoading')}
            onRewarded={(reward, walletCoins) => {
              applyServerAdReward(reward, walletCoins);
              haptic('medium');
              notify('success');
              toast.success(`${t(lang, 'tadsRewardSuccess')} +${reward} ${t(lang, 'coins')}`);
            }}
            onError={(error) => {
              if (error === 'telegram_auth_required') toast.error(t(lang, 'telegramRequired'));
              else if (error === 'ad_cycle_cooldown' || error === 'ad_cycle_limit_reached') toast.error(t(lang, 'adCycleComplete'));
              else if (error === 'adexium_task_not_completed') toast.error(t(lang, 'adNotVerified'));
              else if (error !== 'no_ad_available' && error !== 'ad_timeout') toast.error(t(lang, 'tadsUnavailable'));
              else toast.error(t(lang, 'noAdsAvailable'));
            }}
          />
        ) : (
          <p className="text-center text-xs font-bold text-amber-900/60">{t(lang, 'telegramRequired')}</p>
        )}
        <p className="mt-2 text-center text-[10px] font-bold text-amber-900/60">
          {adProgress?.locked ? t(lang, 'adCycleComplete') : `${t(lang, 'adsRemaining')}: ${adProgress?.remaining ?? 30}`}
        </p>
      </div>

      {/* Official Telegram join tasks */}
      <div className="mb-3">
        <div className="flex items-center gap-1.5 mb-2 px-1">
          <Send className="w-4 h-4 text-sky-600" />
          <h3 className="text-sm font-black text-[#2a1c0a]">{lang === 'ar' ? 'مهام تيليجرام الرسمية' : lang === 'ru' ? 'Официальные задания Telegram' : 'Official Telegram tasks'}</h3>
        </div>
        <div className="space-y-2">
          {([
            { id: 'channel' as const, title: lang === 'ar' ? 'الانضمام للقناة الرسمية للعملة' : lang === 'ru' ? 'Подписаться на официальный канал' : 'Join the official coin channel', action: lang === 'ar' ? 'اشتراك' : lang === 'ru' ? 'Подписаться' : 'Subscribe', url: 'https://t.me/qrmcooil', icon: Send },
            { id: 'group' as const, title: lang === 'ar' ? 'الانضمام للجروب الرسمي للعملة' : lang === 'ru' ? 'Вступить в официальную группу' : 'Join the official coin group', action: lang === 'ar' ? 'انضمام' : lang === 'ru' ? 'Вступить' : 'Join', url: 'https://t.me/armcooil', icon: Users },
          ]).map((task) => {
            const Icon = task.icon;
            const claimed = telegramClaims[task.id];
            const joined = telegramJoined[task.id];
            return (
              <div key={task.id} className="aram-card rounded-2xl p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-black text-[#2a1c0a]">{task.title}</div>
                  <a href={task.url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-sky-700 underline">{task.url.replace('https://t.me/', '@')}</a>
                  <div className="text-[10px] font-black text-emerald-700 mt-1">+2,000 {t(lang, 'coins')}</div>
                </div>
                {claimed ? (
                  <Button disabled className="h-8 px-3 rounded-xl text-[10px] font-black shrink-0 bg-emerald-500 text-white">
                    {lang === 'ar' ? (joined ? 'مشترك ✓' : 'تم التحقق ✓') : (joined ? 'Joined ✓' : 'Verified ✓')}
                  </Button>
                ) : joined ? (
                  <Button
                    disabled={!isVerified || telegramTaskLoading !== null}
                    onClick={() => void claimTelegramTask(task.id)}
                    className="h-8 px-3 rounded-xl text-[10px] font-black shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {telegramTaskLoading === task.id ? (lang === 'ar' ? 'جارٍ التحقق' : 'Checking…') : (lang === 'ar' ? 'تحقق' : lang === 'ru' ? 'Проверить' : 'Verify')}
                  </Button>
                ) : (
                  <a
                    href={task.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setAwaitingTelegramTask(task.id)}
                    className="h-8 px-3 rounded-xl text-[10px] font-black shrink-0 bg-sky-600 hover:bg-sky-700 text-white inline-flex items-center justify-center"
                  >
                    {task.action}
                  </a>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[9px] text-amber-900/60 font-bold px-1 mt-2">
          {lang === 'ar' ? 'يتم التحقق من استمرار الاشتراك كل 10 ساعات. عند المغادرة تُخصم مكافأة المهمة من رصيدك.' : 'Membership is rechecked every 10 hours. Leaving the channel or group deducts the task reward.'}
        </p>
      </div>

      {/* Telegram Story daily reward */}
      <div className="aram-card rounded-2xl p-3 mb-3 border border-amber-400/30">
        <div className="flex items-center gap-2 mb-2">
          <Camera className="w-5 h-5 text-amber-600" />
          <div className="flex-1">
            <div className="text-sm font-black text-[#2a1c0a]">{lang === 'ar' ? 'انشر حالة ARMCO OIL على تيليجرام' : lang === 'ru' ? 'Опубликуйте историю ARMCO OIL в Telegram' : 'Post ARMCO OIL to your Telegram Story'}</div>
            <div className="text-[10px] font-black text-emerald-700">+500 {t(lang, 'coins')} · {lang === 'ar' ? 'مرة كل 24 ساعة بعد الموافقة' : 'Once every 24 hours after approval'}</div>
          </div>
        </div>
        <p className="text-[11px] text-amber-900/70 mb-3">{lang === 'ar' ? 'افتح محرر الحالة، انشر البوستر مع رابط @armcooilbot، ثم انسخ رابط الحالة العامة وأرسله للمراجعة.' : 'Open Story editor, publish the poster with @armcooilbot, then paste your public Story link for review.'}</p>
        <Button onClick={openStoryComposer} disabled={!isVerified} className="w-full rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-black">
          <Camera className="w-4 h-4 ml-2" /> {lang === 'ar' ? 'انشر الحالة' : lang === 'ru' ? 'Опубликовать историю' : 'Publish Story'}
        </Button>
        {storyInfo?.pending ? (
          <div className="mt-3 rounded-xl bg-amber-100/80 p-3 text-xs font-bold text-amber-900">
            <Clock className="inline w-4 h-4 ml-1" /> {lang === 'ar' ? 'رابط حالتك قيد مراجعة الإدارة.' : 'Your Story link is awaiting admin review.'}
            <a href={storyInfo.pending.story_url} target="_blank" rel="noopener noreferrer" className="block mt-1 underline break-all">{storyInfo.pending.story_url}</a>
          </div>
        ) : storyInfo?.latest?.status === 'approved' && storyInfo.nextAllowedAt && Date.now() < storyInfo.nextAllowedAt ? (
          <div className="mt-3 rounded-xl bg-emerald-100/80 p-3 text-xs font-bold text-emerald-800">
            <Check className="inline w-4 h-4 ml-1" /> {lang === 'ar' ? 'تم اعتماد حالتك وصرف 500 عملة. المهمة التالية متاحة بعد:' : 'Approved! 500 coins awarded. Next task available:'} {new Date(storyInfo.nextAllowedAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {storyInfo?.latest?.status === 'rejected' && <p className="text-[10px] font-bold text-red-700">{storyInfo.latest.review_reason || 'تمت مراجعة حالتك ولم تنشر صورة اللعبة'}</p>}
            <input value={storyUrl} onChange={e=>setStoryUrl(e.target.value)} placeholder={lang === 'ar' ? 'الصق رابط الحالة العامة هنا (t.me/.../s/...)' : 'Paste your public Story link (t.me/.../s/...)'} className="w-full rounded-xl border border-amber-900/15 bg-white/80 px-3 py-2 text-xs text-slate-900 outline-none" dir="ltr" />
            <Button onClick={() => void submitStoryLink()} disabled={!isVerified || !storyUrl.trim() || storySubmitting || storyInfo?.canSubmit === false} className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black">
              <ExternalLink className="w-4 h-4 ml-2" /> {storySubmitting ? (lang === 'ar' ? 'جارٍ الإرسال...' : 'Submitting…') : (lang === 'ar' ? 'إرسال الرابط للمراجعة' : 'Submit link for review')}
            </Button>
          </div>
        )}
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
