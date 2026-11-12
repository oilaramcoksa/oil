// aramcooil game state — Zustand store with localStorage persistence.
// Coins can be withdrawn in TON at 100,000 coins = 1 USD (see lib/withdraw.ts).
// Withdrawal requests live on the server (/api/withdrawals); the store keeps
// a local mirror and locks the coins while a request is pending.
// Upgrades are purchases of in-game content and promise no financial return.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Lang } from './i18n';
import { PACKAGES, packageTotal, UPGRADE_DURATION_MS, type UpgradePackage, type CryptoWallet } from './wallets';
import { generateMockLeaderboard, getMonthKey } from './tournaments';
import { COINS_PER_USD, type WithdrawalRecord } from './withdraw';

export interface Transaction {
  id: string;
  type: 'sell' | 'upgrade' | 'task' | 'referral' | 'daily' | 'withdraw' | 'refund';
  amount: number;       // game coins (positive = added)
  label: string;        // human-readable label
  createdAt: number;    // ms timestamp
  meta?: Record<string, string | number>;
}

export interface TaskState {
  id: string;
  kind: 'login' | 'taps' | 'sell' | 'invite' | 'upgrade' | 'weekTaps' | 'weekSell' | 'weekInvite';
  period: 'daily' | 'weekly';
  target: number;
  progress: number;
  reward: number;       // game coins
  claimed: boolean;
  lastReset?: number;
}

export interface Referral {
  id: string;
  name: string;
  joinedAt: number;
  earned: number;       // coins earned from this referral
  active: boolean;
}

export interface UpgradeRecord {
  packageId: UpgradePackage['id'];
  purchasedAt: number;
  expiresAt: number;       // ms timestamp when this upgrade expires (30 days from purchase)
  paidWith: CryptoWallet['code'];
  txHash: string;
}

// Helper: filter upgrades that are still active (not expired).
export function isActiveUpgrade(u: UpgradeRecord, now: number = Date.now()): boolean {
  return u.expiresAt > now;
}
export function filterActiveUpgrades(upgrades: UpgradeRecord[], now: number = Date.now()): UpgradeRecord[] {
  return upgrades.filter((u) => isActiveUpgrade(u, now));
}

interface GameState {
  // user
  userId: string;
  userName: string;
  lang: Lang;
  onboarded: boolean;
  acceptedDisclaimer: boolean;

  // wallet (all in-game numbers)
  oil: number;          // current oil drops in storage
  coins: number;        // game coins
  baseOilPerTap: number;
  baseCapacity: number;

  // upgrades & tasks
  upgrades: UpgradeRecord[];
  tasks: TaskState[];
  referrals: Referral[];
  transactions: Transaction[];

  // withdrawals (TON)
  tonAddress: string;                 // last address the player used
  withdrawals: WithdrawalRecord[];    // local mirror of server requests
  refundedWithdrawals: string[];      // rejected request ids already refunded

  // settings
  sound: boolean;
  vibration: boolean;

  // counters (for tasks + achievements + leaderboard)
  tapsToday: number;
  sellsToday: number;
  qualifiedSellsToday: number;   // sells that gave >=300 coins (for daily task)
  tapsThisWeek: number;
  sellsThisWeek: number;
  tapsTotal: number;             // lifetime taps (for achievements)
  sellsTotal: number;            // lifetime sells (for achievements)
  coinsEarnedThisMonth: number;  // for monthly leaderboard ranking
  lastMonthKey: string;          // YYYY-MM, for monthly reset
  lastLoginDay: string;          // YYYY-MM-DD
  loginStreak: number;           // 1-7, consecutive login days
  luckyBoxLastOpened: string | null; // ISO week key when last opened

  // Tournament & store economics
  totalStoreRevenue: number;     // USD, sum of upgrade prices paid
  tournamentHistory: { month: string; rank: number; prize: number }[];
  claimedAchievements: string[];

  // 12-hour pump cycle (passive oil production — adds liters to `oil`)
  cycleEndsAt: number | null;    // ms timestamp when current cycle ends
  lastTickAt: number | null;     // ms timestamp of last passive liter credit

  // actions
  setLang: (l: Lang) => void;
  completeOnboarding: () => void;
  acceptDisclaimer: () => void;
  toggleSound: () => void;
  toggleVibration: () => void;

  tapPump: () => { oilAdded: number; newTotal: number; full: boolean; cycleStarted: boolean };
  sellOil: () => { sold: number; coinsEarned: number };
  buyUpgrade: (pkg: UpgradePackage['id'], wallet: CryptoWallet['code'], txHash: string) => void;
  claimTask: (taskId: string) => { ok: boolean; reward?: number };
  addReferral: (name: string) => void;
  resetDailyIfNeeded: () => void;
  resetWeeklyIfNeeded: () => void;
  processPassive: () => { litersAdded: number; cycleEnded: boolean };
  startCycle: () => void;
  claimAchievement: (id: string, reward: number) => void;
  resetMonthlyIfNeeded: () => void;
  openLuckyBox: () => { reward: number } | null;

  requestWithdrawal: (units: number, tonAddress: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  syncWithdrawals: () => Promise<void>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_MS = 12 * 60 * 60 * 1000; // 12 hours
const baseCapacity = 500;
const baseOilPerTap = 2;
const coinsPerOil = 5; // 1 oil = 5 coins (in-game only)
const baseCoinsPerHour = 60; // passive coin rate with no upgrades

function todayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
function weekKey(d = new Date()): string {
  // ISO week year + week number
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${week}`;
}

function defaultTasks(): TaskState[] {
  return [
    { id: 'd_login', kind: 'login', period: 'daily', target: 1, progress: 0, reward: 100, claimed: false },
    { id: 'd_taps', kind: 'taps', period: 'daily', target: 100, progress: 0, reward: 250, claimed: false },
    { id: 'd_sell', kind: 'sell', period: 'daily', target: 3, progress: 0, reward: 300, claimed: false },
    { id: 'd_invite', kind: 'invite', period: 'daily', target: 3, progress: 0, reward: 500, claimed: false },
    { id: 'd_upgrade', kind: 'upgrade', period: 'daily', target: 1, progress: 0, reward: 1000, claimed: false },
    { id: 'w_taps', kind: 'weekTaps', period: 'weekly', target: 1000, progress: 0, reward: 2000, claimed: false },
    { id: 'w_sell', kind: 'weekSell', period: 'weekly', target: 20, progress: 0, reward: 3000, claimed: false },
    { id: 'w_invite', kind: 'weekInvite', period: 'weekly', target: 10, progress: 0, reward: 5000, claimed: false },
  ];
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export const useGame = create<GameState>()(
  persist(
    (set, get) => ({
      userId: 'guest_' + Math.random().toString(36).slice(2, 10),
      userName: 'Player',
      lang: 'ar',
      onboarded: false,
      acceptedDisclaimer: false,

      oil: 0,
      coins: 0,
      baseOilPerTap,
      baseCapacity,

      upgrades: [],
      tasks: defaultTasks(),
      referrals: [],
      transactions: [],

      tonAddress: '',
      withdrawals: [],
      refundedWithdrawals: [],

      sound: true,
      vibration: true,

      tapsToday: 0,
      sellsToday: 0,
      qualifiedSellsToday: 0,
      tapsThisWeek: 0,
      sellsThisWeek: 0,
      tapsTotal: 0,
      sellsTotal: 0,
      coinsEarnedThisMonth: 0,
      lastMonthKey: '',
      lastLoginDay: '',
      loginStreak: 0,
      luckyBoxLastOpened: null,

      totalStoreRevenue: 0,
      tournamentHistory: [],
      claimedAchievements: [],

      cycleEndsAt: null,
      lastTickAt: null,

      setLang: (l) => set({ lang: l }),
      completeOnboarding: () => set({ onboarded: true }),
      acceptDisclaimer: () => set({ acceptedDisclaimer: true }),
      toggleSound: () => set((s) => ({ sound: !s.sound })),
      toggleVibration: () => set((s) => ({ vibration: !s.vibration })),

      // Effective oil-per-tap = base + sum of upgrades' oilPerTap
      // (each upgrade stacks; the highest tier dominates the passive rate)
      tapPump: () => {
        const s = get();
        // First: if cycle is off (or never started), start a new 12-hour cycle.
        let cycleStarted = false;
        const now = Date.now();
        if (!s.cycleEndsAt || now >= s.cycleEndsAt) {
          cycleStarted = true;
        }

        const totalCap = s.baseCapacity + filterActiveUpgrades(s.upgrades, now).length * 250;
        if (s.oil >= totalCap) {
          // Even if storage is full, still (re)start the cycle if needed.
          if (cycleStarted) {
            set({
              cycleEndsAt: now + CYCLE_MS,
              lastTickAt: now,
              tapsToday: s.tapsToday + 1,
              tapsThisWeek: s.tapsThisWeek + 1,
              tapsTotal: s.tapsTotal + 1,
              tasks: bumpTasks(s.tasks, [
                { kind: 'taps', by: 1 },
                { kind: 'weekTaps', by: 1 },
              ]),
            });
          }
          return { oilAdded: 0, newTotal: s.oil, full: true, cycleStarted };
        }
        const upgradeTap = filterActiveUpgrades(s.upgrades, now).reduce((acc, u) => {
          const pkg = PACKAGES.find((p) => p.id === u.packageId);
          return acc + (pkg?.oilPerTap ?? 0);
        }, 0);
        const perTap = baseOilPerTap + upgradeTap;
        const newTotal = Math.min(totalCap, s.oil + perTap);
        const oilAdded = newTotal - s.oil;

        set({
          oil: newTotal,
          tapsToday: s.tapsToday + 1,
          tapsThisWeek: s.tapsThisWeek + 1,
          tapsTotal: s.tapsTotal + 1,
          ...(cycleStarted
            ? { cycleEndsAt: now + CYCLE_MS, lastTickAt: now }
            : {}),
          tasks: bumpTasks(s.tasks, [
            { kind: 'taps', by: 1 },
            { kind: 'weekTaps', by: 1 },
          ]),
        });
        return { oilAdded, newTotal, full: false, cycleStarted };
      },

      startCycle: () => {
        const s = get();
        const now = Date.now();
        if (s.cycleEndsAt && now < s.cycleEndsAt) return; // already active
        set({ cycleEndsAt: now + CYCLE_MS, lastTickAt: now });
      },

      processPassive: () => {
        const s = get();
        if (!s.cycleEndsAt || !s.lastTickAt) {
          return { litersAdded: 0, cycleEnded: false };
        }
        const now = Date.now();
        // Rate in coins/hour (informational) → convert to liters/hour (5 coins/L).
        // Only count ACTIVE (non-expired) upgrades.
        const rateCoinsPerHour = baseCoinsPerHour + filterActiveUpgrades(s.upgrades, now).reduce((acc, u) => {
          const pkg = PACKAGES.find((p) => p.id === u.packageId);
          return acc + (pkg?.perHour ?? 0);
        }, 0);
        const rateLitersPerHour = rateCoinsPerHour / coinsPerOil;
        const totalCap = s.baseCapacity + filterActiveUpgrades(s.upgrades, now).length * 250;

        // If cycle has ended, credit liters up to cycleEndsAt and stop.
        if (now >= s.cycleEndsAt) {
          const elapsedH = (s.cycleEndsAt - s.lastTickAt) / 3600000;
          const litersAdded = Math.max(0, Math.round(elapsedH * rateLitersPerHour));
          if (litersAdded > 0) {
            const newOil = Math.min(totalCap, s.oil + litersAdded);
            const actualAdded = newOil - s.oil;
            if (actualAdded > 0) {
              set({ oil: newOil, lastTickAt: null });
            } else {
              set({ lastTickAt: null });
            }
          } else {
            set({ lastTickAt: null });
          }
          return { litersAdded, cycleEnded: true };
        }
        // Cycle still active — credit liters for elapsed time since last tick.
        const elapsedH = (now - s.lastTickAt) / 3600000;
        if (elapsedH < 0.0005) return { litersAdded: 0, cycleEnded: false }; // <2s, skip
        const litersAdded = Math.round(elapsedH * rateLitersPerHour);
        if (litersAdded <= 0) {
          // Don't update lastTickAt — keep accumulating fractional time
          // so the next tick can credit the buffered amount.
          return { litersAdded: 0, cycleEnded: false };
        }
        const newOil = Math.min(totalCap, s.oil + litersAdded);
        const actualAdded = newOil - s.oil;
        if (actualAdded <= 0) {
          // Storage full — production wasted until user sells. Don't update lastTickAt
          // so the buffered time credits once there's space.
          return { litersAdded: 0, cycleEnded: false };
        }
        set({ oil: newOil, lastTickAt: now });
        return { litersAdded: actualAdded, cycleEnded: false };
      },

      sellOil: () => {
        const s = get();
        if (s.oil <= 0) return { sold: 0, coinsEarned: 0 };
        // Flat conversion: 5 coins per liter (= 100 coins per 20L barrel).
        const coinsEarned = s.oil * coinsPerOil;
        const sold = s.oil;
        const qualifies = coinsEarned >= 300; // sell counts toward tasks only if >=300 coins
        const tx: Transaction = {
          id: makeId(),
          type: 'sell',
          amount: coinsEarned,
          label: 'txSell',
          createdAt: Date.now(),
          meta: { oil: sold, barrels: Math.floor(sold / 20), qualified: qualifies },
        };
        set({
          oil: 0,
          coins: s.coins + coinsEarned,
          sellsToday: s.sellsToday + 1,
          sellsThisWeek: s.sellsThisWeek + 1,
          sellsTotal: s.sellsTotal + 1,
          qualifiedSellsToday: s.qualifiedSellsToday + (qualifies ? 1 : 0),
          coinsEarnedThisMonth: s.coinsEarnedThisMonth + coinsEarned,
          transactions: [tx, ...s.transactions].slice(0, 50),
          // Only bump sell tasks if the sell qualifies (>=300 coins)
          ...(qualifies
            ? { tasks: bumpTasks(s.tasks, [
                { kind: 'sell', by: 1 },
                { kind: 'weekSell', by: 1 },
              ]) }
            : {}),
        });
        return { sold, coinsEarned };
      },

      buyUpgrade: (pkgId, wallet, txHash) => {
        const s = get();
        const pkg = PACKAGES.find((p) => p.id === pkgId);
        if (!pkg) return;
        const record: UpgradeRecord = {
          packageId: pkgId,
          purchasedAt: Date.now(),
          expiresAt: Date.now() + UPGRADE_DURATION_MS,
          paidWith: wallet,
          txHash,
        };
        const tx: Transaction = {
          id: makeId(),
          type: 'upgrade',
          amount: -pkg.priceUSD,
          label: 'txUpgrade',
          createdAt: Date.now(),
          meta: { tier: pkgId, wallet },
        };
        set({
          upgrades: [...s.upgrades, record],
          totalStoreRevenue: s.totalStoreRevenue + pkg.priceUSD,
          transactions: [tx, ...s.transactions].slice(0, 50),
          tasks: bumpTasks(s.tasks, [{ kind: 'upgrade', by: 1 }]),
        });
      },

      claimTask: (taskId) => {
        const s = get();
        const task = s.tasks.find((t) => t.id === taskId);
        if (!task || task.claimed || task.progress < task.target) {
          return { ok: false };
        }
        const reward = task.reward;
        const tx: Transaction = {
          id: makeId(),
          type: task.period === 'daily' ? 'daily' : 'task',
          amount: reward,
          label: task.period === 'daily' ? 'txDaily' : 'txTask',
          createdAt: Date.now(),
          meta: { task: task.id },
        };
        set({
          coins: s.coins + reward,
          coinsEarnedThisMonth: s.coinsEarnedThisMonth + reward,
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, claimed: true } : t)),
          transactions: [tx, ...s.transactions].slice(0, 50),
        });
        return { ok: true, reward };
      },

      addReferral: (name) => {
        const s = get();
        const ref: Referral = {
          id: makeId(),
          name,
          joinedAt: Date.now(),
          earned: 500,
          active: true,
        };
        const tx: Transaction = {
          id: makeId(),
          type: 'referral',
          amount: 500,
          label: 'txReferral',
          createdAt: Date.now(),
          meta: { name },
        };
        set({
          referrals: [ref, ...s.referrals],
          coins: s.coins + 500,
          coinsEarnedThisMonth: s.coinsEarnedThisMonth + 500,
          transactions: [tx, ...s.transactions].slice(0, 50),
          tasks: bumpTasks(s.tasks, [
            { kind: 'invite', by: 1 },
            { kind: 'weekInvite', by: 1 },
          ]),
        });
      },

      resetDailyIfNeeded: () => {
        const s = get();
        const today = todayStr();
        if (s.lastLoginDay !== today) {
          // Daily reset + login task tick
          const newTasks = s.tasks.map((t) =>
            t.period === 'daily'
              ? { ...t, progress: t.kind === 'login' ? 1 : 0, claimed: false }
              : t
          );

          // === Login streak logic ===
          // Day 1: 1 coin, Day 2: 2 coins, ... Day 7: 7 coins, then restart from 1.
          // Reset to 1 if a day was missed (not consecutive).
          const yesterdayStr = (() => {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            return d.toISOString().slice(0, 10);
          })();
          let newStreak: number;
          if (s.lastLoginDay === yesterdayStr) {
            // Consecutive — increment, cap at 7, then restart from 1
            newStreak = s.loginStreak >= 7 ? 1 : s.loginStreak + 1;
          } else {
            // First login or missed a day — start at 1
            newStreak = 1;
          }
          const loginBonus = newStreak; // Day N = N coins

          const tx: Transaction = {
            id: makeId(),
            type: 'daily',
            amount: loginBonus,
            label: 'txDaily',
            createdAt: Date.now(),
            meta: { streak: newStreak },
          };
          set({
            lastLoginDay: today,
            loginStreak: newStreak,
            tapsToday: 0,
            sellsToday: 0,
            qualifiedSellsToday: 0,
            tasks: newTasks,
            coins: s.coins + loginBonus,
            coinsEarnedThisMonth: s.coinsEarnedThisMonth + loginBonus,
            transactions: [tx, ...s.transactions].slice(0, 50),
          });
        }
      },

      resetWeeklyIfNeeded: () => {
        const s = get();
        const wk = weekKey();
        const lastWeek = (s as unknown as { _lastWeek?: string })._lastWeek;
        if (lastWeek !== wk) {
          const newTasks = s.tasks.map((t) =>
            t.period === 'weekly' ? { ...t, progress: 0, claimed: false } : t
          );
          set({
            tasks: newTasks,
            tapsThisWeek: 0,
            sellsThisWeek: 0,
            ...(lastWeek === undefined ? {} : {}),
          } as Partial<GameState>);
          // store the marker via a non-typed extension
          (s as unknown as { _lastWeek?: string })._lastWeek = wk;
        }
      },

      claimAchievement: (id, reward) => {
        const s = get();
        if (s.claimedAchievements.includes(id)) return;
        const tx: Transaction = {
          id: makeId(),
          type: 'task',
          amount: reward,
          label: 'txAchievement',
          createdAt: Date.now(),
          meta: { achievement: id },
        };
        set({
          coins: s.coins + reward,
          // Achievement rewards do NOT count toward monthly leaderboard ranking
          // (would be recursive). They are one-shot bonuses.
          claimedAchievements: [...s.claimedAchievements, id],
          transactions: [tx, ...s.transactions].slice(0, 50),
        });
      },

      resetMonthlyIfNeeded: () => {
        const s = get();
        const mk = getMonthKey();
        if (s.lastMonthKey && s.lastMonthKey !== mk) {
          // Month changed — finalize previous month's tournament.
          // Determine user's rank in the previous month's leaderboard.
          const prevDate = new Date();
          prevDate.setMonth(prevDate.getMonth() - 1);
          const prevKey = getMonthKey(prevDate);
          const leaderboard = generateMockLeaderboard(
            s.coinsEarnedThisMonth,
            s.userName,
            prevKey
          );
          const userEntry = leaderboard.find((e) => e.isUser);
          const rank = userEntry?.rank ?? 0;
          const prize = userEntry?.prize?.coins ?? 0;
          const newHistory = rank > 0 && prize > 0
            ? [...s.tournamentHistory, { month: s.lastMonthKey, rank, prize }]
            : s.tournamentHistory;
          // Credit prize if user was in top 5
          const updates: Partial<GameState> = {
            lastMonthKey: mk,
            coinsEarnedThisMonth: 0,
            tournamentHistory: newHistory.slice(-12),
          };
          if (prize > 0) {
            const tx: Transaction = {
              id: makeId(),
              type: 'task',
              amount: prize,
              label: 'txTournament',
              createdAt: Date.now(),
              meta: { month: s.lastMonthKey, rank },
            };
            updates.coins = s.coins + prize;
            updates.transactions = [tx, ...s.transactions].slice(0, 50);
          }
          set(updates);
        } else if (!s.lastMonthKey) {
          set({ lastMonthKey: mk });
        }
      },

      openLuckyBox: () => {
        const s = get();
        const wk = weekKey();
        if (s.luckyBoxLastOpened === wk) return null; // already opened this week
        // Random reward between 10 and 50 coins
        const reward = Math.floor(Math.random() * 41) + 10;
        const tx: Transaction = {
          id: makeId(),
          type: 'daily',
          amount: reward,
          label: 'txLuckyBox',
          createdAt: Date.now(),
          meta: { week: wk },
        };
        set({
          coins: s.coins + reward,
          coinsEarnedThisMonth: s.coinsEarnedThisMonth + reward,
          luckyBoxLastOpened: wk,
          transactions: [tx, ...s.transactions].slice(0, 50),
        });
        return { reward };
      },

      // Create a withdrawal request. The server validates it first; only on
      // success are the coins locked (deducted). No fee is ever charged.
      requestWithdrawal: async (units, tonAddress) => {
        const s = get();
        const coins = units * COINS_PER_USD;
        try {
          const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData ?? '' : '';
          if (!initData) return { ok: false, error: 'telegram_auth_required' };
          const res = await fetch('/api/withdrawals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
            body: JSON.stringify({
              units,
              tonAddress,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.withdrawal) {
            return { ok: false, error: data.error ?? 'server_error' };
          }
          const w = data.withdrawal as WithdrawalRecord;
          const cur = get();
          const tx: Transaction = {
            id: makeId(),
            type: 'withdraw',
            amount: -coins,
            label: 'txWithdraw',
            createdAt: Date.now(),
            meta: { withdrawalId: w.id, usd: units },
          };
          set({
            coins: Number(data.wallet?.coins ?? Math.max(0, cur.coins - coins)),
            tonAddress,
            withdrawals: [w, ...cur.withdrawals.filter((x) => x.id !== w.id)].slice(0, 50),
            transactions: [tx, ...cur.transactions].slice(0, 50),
          });
          return { ok: true };
        } catch {
          return { ok: false, error: 'network_error' };
        }
      },

      // Pull request statuses from the server; refund rejected requests once.
      syncWithdrawals: async () => {
        const s = get();
        try {
          const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData ?? '' : '';
          const res = await fetch('/api/withdrawals', {
            headers: { 'X-Telegram-Init-Data': initData },
            cache: 'no-store',
          });
          if (!res.ok) return;
          const data = (await res.json()) as { withdrawals: WithdrawalRecord[]; wallet?: { coins: number } | null };
          set({
            withdrawals: data.withdrawals,
            ...(data.wallet ? { coins: data.wallet.coins } : {}),
          });
        } catch {
          /* offline — try again next time */
        }
      },
    }),
    {
      name: 'aramcooil-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        userId: s.userId,
        userName: s.userName,
        lang: s.lang,
        onboarded: s.onboarded,
        acceptedDisclaimer: s.acceptedDisclaimer,
        oil: s.oil,
        coins: s.coins,
        upgrades: s.upgrades,
        tasks: s.tasks,
        referrals: s.referrals,
        transactions: s.transactions,
        tonAddress: s.tonAddress,
        withdrawals: s.withdrawals,
        refundedWithdrawals: s.refundedWithdrawals,
        sound: s.sound,
        vibration: s.vibration,
        tapsToday: s.tapsToday,
        sellsToday: s.sellsToday,
        qualifiedSellsToday: s.qualifiedSellsToday,
        tapsThisWeek: s.tapsThisWeek,
        sellsThisWeek: s.sellsThisWeek,
        tapsTotal: s.tapsTotal,
        sellsTotal: s.sellsTotal,
        coinsEarnedThisMonth: s.coinsEarnedThisMonth,
        lastMonthKey: s.lastMonthKey,
        lastLoginDay: s.lastLoginDay,
        loginStreak: s.loginStreak,
        luckyBoxLastOpened: s.luckyBoxLastOpened,
        totalStoreRevenue: s.totalStoreRevenue,
        tournamentHistory: s.tournamentHistory,
        claimedAchievements: s.claimedAchievements,
        cycleEndsAt: s.cycleEndsAt,
        lastTickAt: s.lastTickAt,
      }),
    }
  )
);

// Helper: increment progress on matching task kinds (capped at target).
function bumpTasks(tasks: TaskState[], increments: { kind: TaskState['kind']; by: number }[]): TaskState[] {
  return tasks.map((t) => {
    const inc = increments.find((i) => i.kind === t.kind);
    if (!inc || t.claimed) return t;
    return { ...t, progress: Math.min(t.target, t.progress + inc.by) };
  });
}

// Derived helpers — all filter out EXPIRED upgrades.
export function effectiveSpeed(upgrades: UpgradeRecord[], now: number = Date.now()): number {
  return filterActiveUpgrades(upgrades, now).reduce((acc, u) => {
    const pkg = PACKAGES.find((p) => p.id === u.packageId);
    return acc + (pkg ? packageTotal(pkg) : 0);
  }, 0);
}

export function effectiveCapacity(upgrades: UpgradeRecord[], base: number = baseCapacity, now: number = Date.now()): number {
  return base + filterActiveUpgrades(upgrades, now).length * 250;
}

export function effectiveOilPerTap(upgrades: UpgradeRecord[], now: number = Date.now()): number {
  return baseOilPerTap + filterActiveUpgrades(upgrades, now).reduce((acc, u) => {
    const pkg = PACKAGES.find((p) => p.id === u.packageId);
    return acc + (pkg?.oilPerTap ?? 0);
  }, 0);
}

export function effectivePerHour(upgrades: UpgradeRecord[], now: number = Date.now()): number {
  return filterActiveUpgrades(upgrades, now).reduce((acc, u) => {
    const pkg = PACKAGES.find((p) => p.id === u.packageId);
    return acc + (pkg?.perHour ?? 0);
  }, 0);
}

// Passive coin rate per hour = 60 base + sum of active upgrade perHour bonuses.
export function effectiveCoinsPerHour(upgrades: UpgradeRecord[], now: number = Date.now()): number {
  return baseCoinsPerHour + effectivePerHour(upgrades, now);
}

// Is the pump cycle currently active? (cycleEndsAt in the future)
export function isCycleActive(cycleEndsAt: number | null, now: number = Date.now()): boolean {
  return !!cycleEndsAt && now < cycleEndsAt;
}

// Seconds remaining in current cycle (0 if cycle is off or ended).
export function cycleSecondsRemaining(cycleEndsAt: number | null, now: number = Date.now()): number {
  if (!cycleEndsAt) return 0;
  const rem = Math.max(0, Math.floor((cycleEndsAt - now) / 1000));
  return rem;
}

// Cycle length (12 hours) in seconds — used for progress bar.
export const CYCLE_SECONDS = CYCLE_MS / 1000;

// Barrel conversion: 20 liters = 1 barrel = 100 coins (5 coins per liter).
export const LITERS_PER_BARREL = 20;
export const COINS_PER_BARREL = 100;
export const COINS_PER_LITER = coinsPerOil; // 5

export function litersToBarrels(liters: number): number {
  return Math.floor(liters / LITERS_PER_BARREL);
}
export function litersToCoins(liters: number): number {
  return liters * COINS_PER_LITER;
}
