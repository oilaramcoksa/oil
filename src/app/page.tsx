'use client';

import { useEffect, useState } from 'react';
import { useGame } from '@/lib/store';
import { dirOf } from '@/lib/i18n';
import { TopBar } from '@/components/aram/TopBar';
import { BottomNav, type Tab } from '@/components/aram/BottomNav';
import { PumpScreen } from '@/components/aram/screens/PumpScreen';
import { WalletScreen } from '@/components/aram/screens/WalletScreen';
import { TasksScreen } from '@/components/aram/screens/TasksScreen';
import { FriendsScreen } from '@/components/aram/screens/FriendsScreen';
import { StoreScreen } from '@/components/aram/screens/StoreScreen';
import { Onboarding } from '@/components/aram/Onboarding';
import { SettingsSheet } from '@/components/aram/SettingsSheet';
import { TournamentsSheet } from '@/components/aram/TournamentsSheet';
import { useTelegram } from '@/hooks/use-telegram';
import { Toaster } from 'sonner';
import { GameCloudSync } from '@/components/aram/GameCloudSync';
import { ArenaScreen } from '@/components/aram/screens/ArenaScreen';

export default function Home() {
  const lang = useGame((s) => s.lang);
  const onboarded = useGame((s) => s.onboarded);
  const resetDaily = useGame((s) => s.resetDailyIfNeeded);
  const resetWeekly = useGame((s) => s.resetWeeklyIfNeeded);
  const resetMonthly = useGame((s) => s.resetMonthlyIfNeeded);
  const { user, startParam, initData, isVerified } = useTelegram();
  const setLang = useGame((s) => s.setLang);
  const addReferral = useGame((s) => s.addReferral);

  const [tab, setTab] = useState<Tab>('pump');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tournamentsOpen, setTournamentsOpen] = useState(false);

  // Daily/weekly/monthly reset on mount
  useEffect(() => {
    resetDaily();
    resetWeekly();
    resetMonthly();
  }, [resetDaily, resetWeekly, resetMonthly]);

  // Sync language from Telegram user
  useEffect(() => {
    if (user?.language_code) {
      const code = user.language_code.toLowerCase();
      if (code.startsWith('ar')) setLang('ar');
      else if (code.startsWith('ru')) setLang('ru');
      else setLang('en');
    }
  }, [user, setLang]);

  // Handle referral start_param (auto-add inviter as a "referral")
  useEffect(() => {
    if (startParam && startParam.startsWith('ref_')) {
      const inviterId = startParam.slice(4);
      if (inviterId && inviterId !== useGame.getState().userId) {
        // In production: notify backend that this user joined via inviterId.
        // Demo: just simulate.
      }
    }
  }, [startParam]);

  // Update document direction
  useEffect(() => {
    document.documentElement.dir = dirOf(lang);
    document.documentElement.lang = lang;
  }, [lang]);

  if (!onboarded) {
    return (
      <div className="aram-app aram-bg">
        <Onboarding />
      </div>
    );
  }

  return (
    <div className="aram-app aram-bg flex flex-col" dir={dirOf(lang)}>
      {isVerified && user && <GameCloudSync initData={initData} userId={user.id} userName={user.username || user.first_name || 'Player'} />}
      <TopBar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTournaments={() => setTournamentsOpen(true)}
      />

      <main className="flex-1 overflow-hidden">
        {tab === 'pump' && <PumpScreen onGoToStore={() => setTab('store')} onGoToArena={() => setTab('arena')} />}
        {tab === 'wallet' && <WalletScreen />}
        {tab === 'tasks' && <TasksScreen />}
        {tab === 'friends' && <FriendsScreen />}
        {tab === 'store' && <StoreScreen />}
        {tab === 'arena' && <ArenaScreen initData={initData} isVerified={isVerified} telegramUserId={user ? String(user.id) : ''} />}
      </main>

      <BottomNav active={tab} onChange={setTab} />

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <TournamentsSheet open={tournamentsOpen} onClose={() => setTournamentsOpen(false)} />

      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: '#2a1c0a',
            color: '#fef3c7',
            border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: '12px',
            fontWeight: 700,
            fontSize: '12px',
          },
        }}
      />
    </div>
  );
}
