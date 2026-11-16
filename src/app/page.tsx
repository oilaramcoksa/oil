'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useGame } from '@/lib/store';
import { dirOf } from '@/lib/i18n';
import { TopBar } from '@/components/aram/TopBar';
import { BottomNav, type Tab } from '@/components/aram/BottomNav';
import { PumpScreen } from '@/components/aram/screens/PumpScreen';




import { Onboarding } from '@/components/aram/Onboarding';
import { SettingsSheet } from '@/components/aram/SettingsSheet';
import { TournamentsSheet } from '@/components/aram/TournamentsSheet';

import { useTelegram } from '@/hooks/use-telegram';
import { Toaster } from 'sonner';
import { GameCloudSync } from '@/components/aram/GameCloudSync';
import { AdminNotices } from '@/components/aram/AdminNotices';
import { ArenaInviteNotice } from '@/components/aram/ArenaInviteNotice';




// Show a lightweight visual placeholder instead of an empty screen while a
// section's code is being downloaded. The actual section is prefetched below.
const ScreenLoading = () => (
  <div className="h-full w-full max-w-md mx-auto px-3 pt-4 space-y-3 animate-pulse" aria-hidden="true">
    <div className="h-7 w-2/5 rounded-lg bg-amber-900/10" />
    <div className="h-24 rounded-2xl bg-amber-900/10" />
    <div className="h-24 rounded-2xl bg-amber-900/10" />
    <div className="h-32 rounded-2xl bg-amber-900/10" />
  </div>
);
const WalletScreen = dynamic(() => import('@/components/aram/screens/WalletScreen').then((m) => m.WalletScreen), { loading: ScreenLoading });
const TasksScreen = dynamic(() => import('@/components/aram/screens/TasksScreen').then((m) => m.TasksScreen), { loading: ScreenLoading });
const FriendsScreen = dynamic(() => import('@/components/aram/screens/FriendsScreen').then((m) => m.FriendsScreen), { loading: ScreenLoading });
const StoreScreen = dynamic(() => import('@/components/aram/screens/StoreScreen').then((m) => m.StoreScreen), { loading: ScreenLoading });
const ArenaScreen = dynamic(() => import('@/components/aram/screens/ArenaScreen').then((m) => m.ArenaScreen), { loading: ScreenLoading });
const SwapScreen = dynamic(() => import('@/components/aram/screens/SwapScreen').then((m) => m.SwapScreen), { loading: ScreenLoading });
const ShortsContest = dynamic(() => import('@/components/aram/ShortsContest').then((m) => m.ShortsContest), { loading: ScreenLoading });

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
  const [shortsOpen, setShortsOpen] = useState(false);

  // Warm the remaining section chunks after the first screen is interactive.
  // This prevents the blank delay on the first tap of Friends, Wallet, Tasks, etc.
  useEffect(() => {
    let cancelled = false;
    const preload = () => {
      if (cancelled) return;
      void Promise.all([
        import('@/components/aram/screens/WalletScreen'),
        import('@/components/aram/screens/TasksScreen'),
        import('@/components/aram/screens/FriendsScreen'),
        import('@/components/aram/screens/StoreScreen'),
        import('@/components/aram/screens/ArenaScreen'),
        import('@/components/aram/screens/SwapScreen'),
      ]).catch(() => {
        // The selected screen can still load normally; do not block gameplay.
      });
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;
    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(preload, { timeout: 1800 });
    } else {
      timeoutHandle = window.setTimeout(preload, 900);
    }
    return () => {
      cancelled = true;
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    };
  }, []);

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
      {isVerified && <AdminNotices initData={initData} isVerified={isVerified} />}
      {isVerified && user && <ArenaInviteNotice initData={initData} isVerified={isVerified} telegramUserId={String(user.id)} onGoToArena={() => setTab('arena')} />}
      {shortsOpen && <ShortsContest onClose={() => setShortsOpen(false)} />}
      <TopBar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTournaments={() => setTournamentsOpen(true)}
      />

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden overscroll-contain">
        {tab === 'pump' && <PumpScreen onGoToStore={() => setTab('store')} onGoToArena={() => setTab('arena')} onOpenShorts={() => setShortsOpen(true)} initData={initData} isVerified={isVerified} />}
        {tab === 'wallet' && <WalletScreen />}
        {tab === 'tasks' && <TasksScreen initData={initData} isVerified={isVerified} />}
        {tab === 'friends' && <FriendsScreen />}
        {tab === 'store' && <StoreScreen initData={initData} isVerified={isVerified} />}
        {tab === 'arena' && <ArenaScreen initData={initData} isVerified={isVerified} telegramUserId={user ? String(user.id) : ''} />}
        {tab === 'swap' && <SwapScreen initData={initData} isVerified={isVerified} />}
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
