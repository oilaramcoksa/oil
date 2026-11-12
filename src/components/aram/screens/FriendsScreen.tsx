'use client';

import { useState } from 'react';
import { useGame } from '@/lib/store';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Users, Copy, Share2, UserPlus, Check, Gift, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTelegram } from '@/hooks/use-telegram';
import { toast } from 'sonner';

export function FriendsScreen() {
  const lang = useGame((s) => s.lang);
  const userId = useGame((s) => s.userId);
  const referrals = useGame((s) => s.referrals);
  const addReferral = useGame((s) => s.addReferral);
  const coins = useGame((s) => s.coins);
  const { tg, haptic, notify } = useTelegram();
  const [copied, setCopied] = useState(false);

  const referralLink = `https://t.me/aramcooil_bot?start=${userId}`;
  const totalEarned = referrals.reduce((acc, r) => acc + r.earned, 0);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      haptic('medium');
      notify('success');
      toast.success(t(lang, 'copySuccess'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t(lang, 'copyFail'));
    }
  };

  const handleShare = () => {
    haptic('light');
    const text = lang === 'ar'
      ? 'تعالى نلعب أرامكو أويل ونستخرج بترول ونجمّع عملات! 🛢️💰'
      : lang === 'ru'
      ? 'Давай играть в Aramco Oil — качаем нефть и собираем монеты! 🛢️💰'
      : 'Come play Aramco Oil — pump oil and collect coins! 🛢️💰';
    const url = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(text)}`;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(url);
    } else {
      window.open(url, '_blank');
    }
  };

  // Simulate a referral join (demo button so the user can see the flow)
  const handleSimulate = () => {
    haptic('medium');
    const name = ['Ahmed', 'Sara', 'Omar', 'Layla', 'Yusuf', 'Mariam', 'Khaled', 'Noor'][Math.floor(Math.random() * 8)];
    addReferral(name);
    notify('success');
  };

  return (
    <div className="max-w-md mx-auto w-full px-3 pt-2 pb-6 aram-scroll" style={{ maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}>
      {/* Title */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center text-white shadow-lg">
          <Users className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-black text-[#2a1c0a]">{t(lang, 'friendsTitle')}</h2>
          <p className="text-[11px] text-amber-900/60 font-bold">{t(lang, 'referralReward')}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="aram-card-dark rounded-2xl p-3"
        >
          <div className="flex items-center gap-1 text-amber-200/70 text-[10px] font-bold uppercase mb-1">
            <Users className="w-3.5 h-3.5" /> {t(lang, 'yourReferrals')}
          </div>
          <div className="text-2xl font-black text-amber-300 tabular-nums">{referrals.length}</div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="aram-card-dark rounded-2xl p-3"
        >
          <div className="flex items-center gap-1 text-amber-200/70 text-[10px] font-bold uppercase mb-1">
            <Gift className="w-3.5 h-3.5" /> {t(lang, 'totalEarned')}
          </div>
          <div className="text-2xl font-black text-emerald-300 tabular-nums">+{totalEarned.toLocaleString()}</div>
        </motion.div>
      </div>

      {/* Invite card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="aram-card rounded-2xl p-4 mb-3"
      >
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-black text-[#2a1c0a]">{t(lang, 'inviteLink')}</h3>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 mb-2">
          <span className="text-xs text-amber-900/80 font-mono truncate flex-1">{referralLink}</span>
          {copied && <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={handleCopy}
            className="h-10 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-[#2a1c0a] font-bold text-sm"
          >
            <Copy className="w-4 h-4 mr-1.5" />
            {t(lang, 'copyLink')}
          </Button>
          <Button
            onClick={handleShare}
            className="h-10 rounded-xl bg-gradient-to-r from-sky-400 to-blue-500 text-white font-bold text-sm"
          >
            <Share2 className="w-4 h-4 mr-1.5" />
            {t(lang, 'shareLink')}
          </Button>
        </div>
        {/* Demo button — simulate a friend joining (remove in production) */}
        <button
          onClick={handleSimulate}
          className="mt-2 w-full text-[10px] text-amber-700/70 font-bold py-1 hover:text-amber-700"
        >
          + {t(lang, 'active')} (demo)
        </button>
      </motion.div>

      {/* Referral list */}
      <div>
        <h3 className="text-sm font-black text-[#2a1c0a] mb-2 px-1">{t(lang, 'yourReferrals')}</h3>
        {referrals.length === 0 ? (
          <div className="aram-card rounded-2xl p-6 text-center">
            <UserPlus className="w-10 h-10 text-amber-400 mx-auto mb-2" />
            <p className="text-amber-900/60 text-xs font-bold">{t(lang, 'noReferrals')}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {referrals.map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="aram-card rounded-xl p-2.5 flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-400 to-blue-500 text-white flex items-center justify-center font-black text-sm">
                  {r.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-[#2a1c0a] truncate">{r.name}</div>
                  <div className="text-[10px] text-amber-900/50 font-bold">
                    {t(lang, 'joined')} · {timeAgo(r.joinedAt, lang)}
                  </div>
                </div>
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-black">
                  +{r.earned}
                </div>
              </motion.div>
            ))}
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
