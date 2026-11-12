'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '@/lib/store';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import {
  X, Trophy, Clock, Crown, Medal, Award, Sparkles, Check, Lock, TrendingUp,
} from 'lucide-react';
import {
  PRIZE_STRUCTURE,
  TOTAL_PRIZE_POOL_USD,
  TOTAL_PRIZE_POOL_COINS,
  PRIZE_FUND_PERCENT,
  ACHIEVEMENTS,
  getMonthKey,
  secondsUntilNextMonth,
  formatLongCountdown,
} from '@/lib/tournaments';
import { useTelegram } from '@/hooks/use-telegram';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function TournamentsSheet({ open, onClose }: Props) {
  const lang = useGame((s) => s.lang);
  const coins = useGame((s) => s.coins);
  const coinsEarnedThisMonth = useGame((s) => s.coinsEarnedThisMonth);
  const userName = useGame((s) => s.userName);
  const totalStoreRevenue = useGame((s) => s.totalStoreRevenue);
  const tournamentHistory = useGame((s) => s.tournamentHistory);
  const claimedAchievements = useGame((s) => s.claimedAchievements);
  const tapsTotal = useGame((s) => s.tapsTotal);
  const sellsTotal = useGame((s) => s.sellsTotal);
  const referrals = useGame((s) => s.referrals);
  const claimAchievement = useGame((s) => s.claimAchievement);
  // Re-render every second for countdown
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  const monthKey = getMonthKey();
  const [leaderboard, setLeaderboard] = useState<Array<{
    rank: number; name: string; coinsEarned: number; isUser: boolean;
    playerId: string; prize?: (typeof PRIZE_STRUCTURE)[number];
  }>>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const { haptic, notify, user: telegramUser, initData, isVerified } = useTelegram();

  useEffect(() => {
    if (!open || !isVerified || !initData) return;
    let cancelled = false;
    setLeaderboardLoading(true);
    fetch('/api/leaderboard', {
      headers: { 'x-telegram-init-data': initData },
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('leaderboard_unavailable');
        return response.json();
      })
      .then((data: { entries?: Array<{ rank: number; name: string; coinsEarned: number; playerId: string }> }) => {
        if (cancelled) return;
        const entries = (data.entries ?? []).map((entry) => ({
          ...entry,
          isUser: entry.playerId === String(telegramUser?.id ?? ''),
          prize: entry.rank <= 5 ? PRIZE_STRUCTURE[entry.rank - 1] : undefined,
        }));
        setLeaderboard(entries);
      })
      .catch(() => { if (!cancelled) setLeaderboard([]); })
      .finally(() => { if (!cancelled) setLeaderboardLoading(false); });
    return () => { cancelled = true; };
  }, [open, isVerified, initData, telegramUser?.id, monthKey]);

  const userEntry = leaderboard.find((e) => e.isUser);
  const userRank = userEntry?.rank ?? 0;
  const top10 = leaderboard.slice(0, 10);
  // Always show the current player even when their position is below the top ten.
  if (userEntry && !top10.some((entry) => entry.isUser)) top10.push(userEntry);

  const countdownSec = secondsUntilNextMonth();
  const countdownStr = formatLongCountdown(countdownSec);

  // Funded prize pool: PRIZE_FUND_PERCENT of store revenue, capped at total.
  const fundedUSD = 0; // Funding is not reported until verified store payments are recorded server-side.

  const handleClaimAchievement = (id: string, reward: number) => {
    haptic('heavy');
    notify('success');
    claimAchievement(id, reward);
    toast.success(`+${reward.toLocaleString()} ${t(lang, 'coins')}`);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center"
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 220 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md bg-gradient-to-b from-[#2a1c0a] to-[#0c0703] rounded-t-3xl sm:rounded-3xl overflow-hidden aram-safe-bottom max-h-[92vh] overflow-y-auto aram-scroll"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-[#2a1c0a]/95 backdrop-blur-md border-b border-amber-500/20 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-400" />
                <h3 className="text-amber-100 font-black text-sm">{t(lang, 'tournaments')}</h3>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {/* === Hero: prize pool + countdown === */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="aram-card-dark rounded-2xl p-4 relative overflow-hidden"
              >
                {/* Decorative trophy watermark */}
                <Trophy className="absolute -top-2 -right-2 w-20 h-20 text-amber-500/10" />

                <div className="flex items-center gap-2 mb-2">
                  <Crown className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-100 text-xs font-black uppercase">
                    {t(lang, 'monthlyTournament')}
                  </span>
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[9px] font-bold">
                    {t(lang, 'skillBased')}
                  </span>
                </div>

                {/* Total prize pool */}
                <div className="text-center mb-3">
                  <div className="text-[10px] text-amber-200/60 font-bold uppercase mb-0.5">
                    {t(lang, 'prizePool')}
                  </div>
                  <div className="text-3xl font-black text-amber-300 tabular-nums leading-none">
                    ${TOTAL_PRIZE_POOL_USD}
                  </div>
                  <div className="text-[10px] text-amber-200/60 font-bold mt-0.5">
                    = {TOTAL_PRIZE_POOL_COINS.toLocaleString()} {t(lang, 'coins')}
                  </div>
                </div>

                {/* Funded amount */}
                <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-3">
                  <div className="text-[10px] text-amber-200/70 font-bold text-center">
                    {t(lang, 'fundedFrom')} {PRIZE_FUND_PERCENT}% {t(lang, 'storeRevenue')}: ${fundedUSD} / ${TOTAL_PRIZE_POOL_USD}
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-amber-900/40 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(fundedUSD / TOTAL_PRIZE_POOL_USD) * 100}%` }}
                      transition={{ duration: 0.6 }}
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-500"
                    />
                  </div>
                </div>

                {/* Countdown */}
                <div className="text-center">
                  <div className="text-[10px] text-amber-200/60 font-bold uppercase mb-0.5">
                    {t(lang, 'nextAnnouncement')}
                  </div>
                  <div className="text-2xl font-black text-emerald-300 tabular-nums tracking-wider">
                    {countdownStr}
                  </div>
                  <div className="text-[9px] text-amber-200/40 font-bold mt-0.5">
                    DD:HH:MM:SS
                  </div>
                </div>
              </motion.div>

              {/* === Top 5 prize structure === */}
              <div className="aram-card-dark rounded-2xl p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Medal className="w-4 h-4 text-amber-400" />
                  <h4 className="text-amber-100 font-bold text-xs uppercase">{t(lang, 'top5')}</h4>
                </div>
                <div className="space-y-1.5">
                  {PRIZE_STRUCTURE.map((p, idx) => (
                    <motion.div
                      key={p.rank}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className={`flex items-center gap-2.5 p-2 rounded-xl ${
                        userRank === p.rank
                          ? 'bg-amber-500/20 border border-amber-400/50'
                          : 'bg-white/5'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${p.color} flex items-center justify-center text-base shadow-lg flex-shrink-0`}>
                        {p.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-amber-100 font-black text-sm">
                          {p.labelAr} / {p.labelEn}
                        </div>
                        <div className="text-[10px] text-amber-200/60 font-bold tabular-nums">
                          {p.coins.toLocaleString()} {t(lang, 'coins')}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-amber-300 font-black text-sm tabular-nums">
                          ${p.usdEquivalent}
                        </div>
                        {userRank === p.rank && (
                          <div className="text-[9px] text-emerald-300 font-bold">
                            ★ {t(lang, 'yourRank')}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* === User rank === */}
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="aram-card-dark rounded-2xl p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg ${
                    userRank > 0 && userRank <= 5
                      ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white'
                      : 'bg-white/10 text-amber-200'
                  }`}>
                    <Trophy className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] text-amber-200/60 font-bold uppercase">
                      {t(lang, 'yourRank')}
                    </div>
                    {userRank > 0 ? (
                      <>
                        <div className="text-xl font-black text-amber-100 tabular-nums leading-none mt-0.5">
                          #{userRank}
                          <span className="text-xs text-amber-200/60 ml-1">/ {leaderboard.length}</span>
                        </div>
                        <div className="text-[9px] text-amber-200/50 font-bold mt-0.5">
                          {coinsEarnedThisMonth.toLocaleString()} {t(lang, 'coins')} · {t(lang, 'month')}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-amber-200/60 font-bold mt-0.5">
                        {t(lang, 'noRankYet')}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-amber-200/60 font-bold uppercase">القيمة الكلية</div>
                  <div className="text-base font-black text-emerald-300 tabular-nums">
                    {coins.toLocaleString()}
                  </div>
                </div>
              </motion.div>

              {/* === Leaderboard top 10 === */}
              <div className="aram-card-dark rounded-2xl p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingUp className="w-4 h-4 text-amber-400" />
                  <h4 className="text-amber-100 font-bold text-xs uppercase">{t(lang, 'leaderboard')}</h4>
                </div>
                <div className="space-y-1 max-h-80 overflow-y-auto aram-scroll">
                  {top10.map((entry) => (
                    <div
                      key={`${entry.rank}-${entry.name}`}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${
                        entry.isUser
                          ? 'bg-amber-500/20 border border-amber-400/40'
                          : entry.rank <= 5
                          ? 'bg-white/5'
                          : ''
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 ${
                        entry.rank === 1 ? 'bg-yellow-400/20 text-yellow-300' :
                        entry.rank === 2 ? 'bg-gray-400/20 text-gray-200' :
                        entry.rank === 3 ? 'bg-orange-400/20 text-orange-300' :
                        entry.rank <= 5 ? 'bg-amber-500/15 text-amber-300' :
                        'bg-white/5 text-amber-200/60'
                      }`}>
                        {entry.rank <= 3 ? PRIZE_STRUCTURE[entry.rank - 1].icon : entry.rank}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-bold truncate ${
                          entry.isUser ? 'text-amber-300' : 'text-amber-100'
                        }`}>
                          {entry.name} {entry.isUser && `(${t(lang, 'player')})`}
                        </div>
                        <div className="text-[10px] text-amber-200/50 font-bold tabular-nums">
                          {entry.coinsEarned.toLocaleString()} {t(lang, 'coins')}
                        </div>
                      </div>
                      {entry.prize && (
                        <div className="text-[10px] text-amber-300 font-black tabular-nums flex-shrink-0">
                          ${entry.prize.usdEquivalent}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* === Achievements === */}
              <div className="aram-card-dark rounded-2xl p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Award className="w-4 h-4 text-amber-400" />
                  <h4 className="text-amber-100 font-bold text-xs uppercase">{t(lang, 'achievements')}</h4>
                </div>
                <div className="space-y-1.5">
                  {ACHIEVEMENTS.map((a) => {
                    const claimed = claimedAchievements.includes(a.id);
                    const current = a.metric === 'coins' ? coins
                      : a.metric === 'taps' ? tapsTotal
                      : a.metric === 'sells' ? sellsTotal
                      : referrals.length;
                    const unlocked = current >= a.threshold;
                    const progress = Math.min(100, (current / a.threshold) * 100);

                    return (
                      <div
                        key={a.id}
                        className={`flex items-center gap-2.5 p-2 rounded-xl ${
                          claimed ? 'bg-emerald-500/10 border border-emerald-500/30'
                          : unlocked ? 'bg-amber-500/15 border border-amber-500/30'
                          : 'bg-white/5'
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${
                          claimed ? 'bg-emerald-500/20'
                          : unlocked ? 'bg-gradient-to-br from-amber-400 to-orange-500'
                          : 'bg-white/5 grayscale opacity-60'
                        }`}>
                          {claimed ? <Check className="w-5 h-5 text-emerald-300" /> : a.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-amber-100 font-bold text-xs">
                            {lang === 'ar' ? a.titleAr : lang === 'ru' ? a.titleRu : a.titleEn}
                          </div>
                          <div className="text-[9px] text-amber-200/60 font-bold">
                            {lang === 'ar' ? a.descAr : lang === 'ru' ? a.descRu : a.descEn}
                          </div>
                          {!claimed && (
                            <div className="mt-1 h-1 rounded-full bg-amber-900/40 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          )}
                          <div className="text-[9px] text-amber-200/50 font-bold mt-0.5 tabular-nums">
                            {current.toLocaleString()} / {a.threshold.toLocaleString()}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <div className="text-[10px] text-amber-300 font-black tabular-nums">
                            +{a.reward.toLocaleString()}
                          </div>
                          {claimed ? (
                            <span className="text-[9px] text-emerald-300 font-bold flex items-center gap-0.5">
                              <Check className="w-3 h-3" /> {t(lang, 'claimed')}
                            </span>
                          ) : unlocked ? (
                            <Button
                              onClick={() => handleClaimAchievement(a.id, a.reward)}
                              size="sm"
                              className="h-6 px-2.5 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold"
                            >
                              {t(lang, 'claim')}
                            </Button>
                          ) : (
                            <span className="text-[9px] text-amber-200/40 font-bold flex items-center gap-0.5">
                              <Lock className="w-3 h-3" /> {t(lang, 'locked')}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* === Past winners === */}
              <div className="aram-card-dark rounded-2xl p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <h4 className="text-amber-100 font-bold text-xs uppercase">{t(lang, 'pastWinners')}</h4>
                </div>
                {tournamentHistory.length === 0 ? (
                  <div className="text-center py-3">
                    <p className="text-amber-200/50 text-xs font-bold">{t(lang, 'noPastWins')}</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {tournamentHistory.slice().reverse().map((h, i) => {
                      const prize = PRIZE_STRUCTURE.find((p) => p.rank === h.rank);
                      return (
                        <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5">
                          <div className="w-7 h-7 rounded-full bg-amber-500/15 text-amber-300 flex items-center justify-center text-base">
                            {prize?.icon || '🏅'}
                          </div>
                          <div className="flex-1">
                            <div className="text-xs font-bold text-amber-100">
                              {h.month} · #{h.rank}
                            </div>
                            <div className="text-[10px] text-amber-200/50 font-bold tabular-nums">
                              +{h.prize.toLocaleString()} {t(lang, 'coins')}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* === Disclaimer === */}
              <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <p className="text-[10px] text-amber-200/80 font-bold leading-relaxed text-center">
                  ⓘ {t(lang, 'tournamentNote')}
                </p>
              </div>

              <Button
                onClick={() => { haptic('light'); onClose(); }}
                className="w-full h-11 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-[#2a1c0a] font-black text-sm"
              >
                {t(lang, 'back')}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
