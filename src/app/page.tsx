'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useGame } from '@/lib/store';
import { dirOf, isLangLoaded, loadLang } from '@/lib/i18n';
import { TopBar } from '@/components/aram/TopBar';
import { BottomNav, type Tab } from '@/components/aram/BottomNav';
import { PumpScreen } from '@/components/aram/screens/PumpScreen';
const WalletScreen = dynamic(() => import('@/components/aram/screens/WalletScreen').then((m) => m.WalletScreen));
const TasksScreen = dynamic(() => import('@/components/aram/screens/TasksScreen').then((m) => m.TasksScreen));
const FriendsScreen = dynamic(() => import('@/components/aram/screens/FriendsScreen').then((m) => m.FriendsScreen));
const StoreScreen = dynamic(() => import('@/components/aram/screens/StoreScreen').then((m) => m.StoreScreen));
const ArenaHubScreen = dynamic(() => import('@/components/aram/screens/ArenaHubScreen').then((m) => m.ArenaHubScreen));
const SwapScreen = dynamic(() => import('@/components/aram/screens/SwapScreen').then((m) => m.SwapScreen));




const Onboarding = dynamic(() => import('@/components/aram/Onboarding').then((m) => m.Onboarding));
const SettingsSheet = dynamic(() => import('@/components/aram/SettingsSheet').then((m) => m.SettingsSheet));
const TournamentsSheet = dynamic(() => import('@/components/aram/TournamentsSheet').then((m) => m.TournamentsSheet));

import { useTelegram } from '@/hooks/use-telegram';
import { Toaster } from 'sonner';
import { GameCloudSync } from '@/components/aram/GameCloudSync';
import { AdminNotices } from '@/components/aram/AdminNotices';
import { ArenaInviteNotice } from '@/components/aram/ArenaInviteNotice';
import { MonetagInAppAds } from '@/components/aram/MonetagInAppAds';




const ShortsContest = dynamic(() => import('@/components/aram/ShortsContest').then((m) => m.ShortsContest));

export default function Home() {
  const lang = useGame((s) => s.lang);
  const onboarded = useGame((s) => s.onboarded);
  const resetDaily = useGame((s) => s.resetDailyIfNeeded);
  const resetWeekly = useGame((s) => s.resetWeeklyIfNeeded);
  const resetMonthly = useGame((s) => s.resetMonthlyIfNeeded);
  const { user, startParam, initData, isVerified } = useTelegram();
  const setLangFromTelegram = useGame((s) => s.setLangFromTelegram);
  const addReferral = useGame((s) => s.addReferral);

  // The active language pack is a lazy chunk: wait for it once so the first paint is never in the wrong language.
  const [, setPackTick] = useState(0);
  useEffect(() => { let alive = true; void loadLang(lang).then(() => { if (alive) setPackTick((n) => n + 1); }).catch(() => undefined); return () => { alive = false; }; }, [lang]);
  const packReady = isLangLoaded(lang);

  const [tab, setTab] = useState<Tab>('pump');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tournamentsOpen, setTournamentsOpen] = useState(false);
  const [shortsOpen, setShortsOpen] = useState(false);
  const [openStoreProductRequest, setOpenStoreProductRequest] = useState(0);
  const [openStoreProductId, setOpenStoreProductId] = useState('plane_tips');
  const [openColorWheelRequest, setOpenColorWheelRequest] = useState(0);
  const [resetArenaHomeRequest, setResetArenaHomeRequest] = useState(0);
  const [resetStoreHomeRequest, setResetStoreHomeRequest] = useState(0);

  // Keep every opened section mounted so returning to it is immediate.
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(() => new Set<Tab>(['pump']));
  const navigateToTab = (nextTab: Tab) => {
    setVisitedTabs((current) => current.has(nextTab) ? current : new Set([...current, nextTab]));
    setTab(nextTab);
  };

  useEffect(() => {
    const openPlaneTipsStore = () => {
      setOpenStoreProductId('plane_tips');
      setOpenStoreProductRequest((current) => current + 1);
      navigateToTab('store');
    };
    window.addEventListener('open-plane-tips-store', openPlaneTipsStore);
    return () => window.removeEventListener('open-plane-tips-store', openPlaneTipsStore);
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
      const code = user.language_code.toLowerCase().replace('_', '-');
      const localeMap: Array<[string, import('@/lib/i18n').Lang]> = [
        ['ar', 'ar'], ['ru', 'ru'], ['es', 'es'], ['pt', 'pt'], ['fr', 'fr'],
        ['de', 'de'], ['tr', 'tr'], ['zh', 'zh'], ['hi', 'hi'], ['id', 'id'],
        ['bn', 'bn'], ['ja', 'ja'], ['ko', 'ko'], ['ur', 'ur'],
      ];
      const matched = localeMap.find(([prefix]) => code === prefix || code.startsWith(prefix + '-'));
      setLangFromTelegram(matched?.[1] ?? 'en');
    }
  }, [user, setLangFromTelegram]);

  // Open the requested game directly from a Telegram invite link.
  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (requestedTab === 'arena' || requestedTab === 'colors' || requestedTab === 'crash') {
      setVisitedTabs((current) => current.has('arena') ? current : new Set([...current, 'arena']));
      setTab('arena');
      if (requestedTab === 'crash') window.setTimeout(() => window.dispatchEvent(new Event('open-crash-game')), 0);
    }
  }, []);

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

  if (!packReady) return <div className="aram-app aram-bg" aria-busy="true" />;

  if (!onboarded) {
    return (
      <div className="aram-app aram-bg">
        <Onboarding />
      </div>
    );
  }

  return (
    <div className="aram-app aram-bg flex flex-col" dir={dirOf(lang)}>
      <MonetagInAppAds enabled />
      {isVerified && user && <GameCloudSync initData={initData} userId={user.id} userName={user.username || user.first_name || 'Player'} />}
      {isVerified && <AdminNotices initData={initData} isVerified={isVerified} />}
      {isVerified && user && <ArenaInviteNotice initData={initData} isVerified={isVerified} telegramUserId={String(user.id)} onGoToArena={() => { navigateToTab('arena'); setOpenColorWheelRequest((current) => current + 1); }} />}
      {shortsOpen && <ShortsContest onClose={() => setShortsOpen(false)} />}
      <TopBar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTournaments={() => setTournamentsOpen(true)}
      />

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden overscroll-contain">
        {visitedTabs.has('pump') && <section className={tab === 'pump' ? 'h-full tab-enter' : 'hidden'}><PumpScreen onGoToStore={() => navigateToTab('store')} onGoToArena={() => navigateToTab('arena')} onOpenShorts={() => setShortsOpen(true)} initData={initData} isVerified={isVerified} /></section>}
        {visitedTabs.has('wallet') && <section className={tab === 'wallet' ? 'h-full tab-enter' : 'hidden'}><WalletScreen /></section>}
        {visitedTabs.has('tasks') && <section className={tab === 'tasks' ? 'h-full tab-enter' : 'hidden'}><TasksScreen initData={initData} isVerified={isVerified} /></section>}
        {visitedTabs.has('friends') && <section className={tab === 'friends' ? 'h-full tab-enter' : 'hidden'}><FriendsScreen /></section>}
        {visitedTabs.has('store') && <section className={tab === 'store' ? 'h-full tab-enter' : 'hidden'}><StoreScreen initData={initData} isVerified={isVerified} openProductRequest={openStoreProductRequest} openProductId={openStoreProductId} resetHomeRequest={resetStoreHomeRequest} /></section>}
        {visitedTabs.has('arena') && <section className={tab === 'arena' ? 'h-full tab-enter' : 'hidden'}><ArenaHubScreen initData={initData} isVerified={isVerified} telegramUserId={user ? String(user.id) : ''} openColorWheelRequest={openColorWheelRequest} resetToHomeRequest={resetArenaHomeRequest} active={tab === 'arena'} onGoToStore={(productId) => { if (productId) { setOpenStoreProductId(productId); setOpenStoreProductRequest((current) => current + 1); } navigateToTab('store'); }} /></section>}
        {visitedTabs.has('swap') && <section className={tab === 'swap' ? 'h-full' : 'hidden'}><SwapScreen initData={initData} isVerified={isVerified} /></section>}
      </main>

      <BottomNav active={tab} onChange={(nextTab) => { if (nextTab === 'arena') setResetArenaHomeRequest((value) => value + 1); if (nextTab === 'store') setResetStoreHomeRequest((value) => value + 1); navigateToTab(nextTab); }} />

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
