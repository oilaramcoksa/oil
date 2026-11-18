// aramcooil game state — Zustand store with localStorage persistence.
// Coins convert at 1,000 coins = 1 USD; minimum withdrawal is $100 (see lib/withdraw.ts).
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
  type: 'sell' | 'upgrade' | 'task' | 'referral' | 'daily' | 'withdraw' | 'refund' | 'ad' | 'arena';
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
  languagePreferenceSet: boolean;
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
  parts: { oil_pump: number; fuel_station: number; oil_truck: number };
  specialParts: { new_background: boolean; vip_badge: boolean; wheel_expansion_until: number | null };

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
  setLangFromTelegram: (l: Lang) => void;
  completeOnboarding: () => void;
  acceptDisclaimer: () => void;
  toggleSound: () => void;
  toggleVibration: () => void;

  tapPump: () => { oilAdded: number; newTotal: number; full: boolean; cycleStarted: boolean };
  sellOil: () => { sold: number; coinsEarned: number };
  applyServerSale: (sold: number, coinsEarned: number, walletOil: number, walletCoins: number) => void;
  applyServerAdReward: (reward: number, walletCoins: number) => void;
  applyServerTaskReward: (reward: number, walletCoins: number, taskId: string) => void;
  syncServerWalletCoins: (walletCoins: number) => void;
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

  requestWithdrawal: (units: number, tonAddress: string, feePaymentId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  syncWithdrawals: () => Promise<void>;
  syncAdminState: (initData: string) => Promise<void>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_MS = 12 * 60 * 60 * 1000; // 12 hours
const baseCapacity = 500;
const baseOilPerTap = 2;
const coinsPerOil = 5; // 1 oil = 5 coins (in-game only)
const baseCoinsPerHour = 60; // passive coin rate with no upgrades

function todayStr(d = new Date()): string {
  // Use the player's local calendar date. UTC ISO slicing shifts the date
  // around local midnight and can keep the seven-day login reward on Day 1.
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
    { id: 'd_taps', kind: 'taps', period: 'daily', target: 100, progress: 0, reward: 200, claimed: false },
    { id: 'd_sell', kind: 'sell', period: 'daily', target: 3, progress: 0, reward: 200, claimed: false },
    { id: 'd_invite', kind: 'invite', period: 'daily', target: 3, progress: 0, reward: 200, claimed: false },
    { id: 'd_upgrade', kind: 'upgrade', period: 'daily', target: 1, progress: 0, reward: 300, claimed: false },
    { id: 'w_taps', kind: 'weekTaps', period: 'weekly', target: 1000, progress: 0, reward: 500, claimed: false },
    { id: 'w_sell', kind: 'weekSell', period: 'weekly', target: 20, progress: 0, reward: 750, claimed: false },
    { id: 'w_invite', kind: 'weekInvite', period: 'weekly', target: 10, progress: 0, reward: 1000, claimed: false },
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
      languagePreferenceSet: false,
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
      parts: { oil_pump: 0, fuel_station: 0, oil_truck: 0 },
      specialParts: { new_background: false, vip_badge: false, wheel_expansion_until: null },

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

      setLang: (l) => set({ lang: l, languagePreferenceSet: true }),
      setLangFromTelegram: (l) => { if (!get().languagePreferenceSet) set({ lang: l }); },
      completeOnboarding: () => set({ onboarded: true }),
      acceptDisclaimer: () => set({ acceptedDisclaimer: true }),
      toggleSound: () => set((s) => ({ sound: !s.sound })),
      toggleVibration: () => set((s) => ({ vibration: !s.vibration })),

      // Effective oil-per-tap = base + sum of upgrades' oilPerTap
      // (each upgrade stacks; the highest tier dominates the passive rate)
      // Mining mutations are server-only. These legacy store actions are inert
      // compatibility shims; PumpScreen calls /api/mining/action instead.
      tapPump: () => ({ oilAdded: 0, newTotal: get().oil, full: false, cycleStarted: false }),

      // Legacy client-side economy actions are intentionally inert. Mining,
      // sales, purchases, tasks and rewards must be validated by server APIs.
      sellOil: () => ({ sold: 0, coinsEarned: 0 }),
      buyUpgrade: () => {},
      claimTask: () => ({ ok: false }),
      addReferral: () => {},
      resetDailyIfNeeded: () => {},
      resetWeeklyIfNeeded: () => {},

      startCycle: () => {
        // A cycle can only be created by the authenticated mining API.
      },

      processPassive: () => ({ litersAdded: 0, cycleEnded: false }),

      applyServerSale: (sold, coinsEarned, walletOil, walletCoins) => {
        const s = get();
        const tx: Transaction = {
          id: makeId(),
          type: 'sell',
          amount: coinsEarned,
          label: 'txSell',
          createdAt: Date.now(),
          meta: { sold },
        };
        set({
          oil: Math.max(0, Number.isSafeInteger(walletOil) ? walletOil : s.oil - sold),
          coins: Math.max(0, walletCoins),
          coinsEarnedThisMonth: s.coinsEarnedThisMonth + Math.max(0, coinsEarned),
          sellsToday: s.sellsToday + 1,
          sellsThisWeek: s.sellsThisWeek + 1,
          sellsTotal: s.sellsTotal + 1,
          qualifiedSellsToday: s.qualifiedSellsToday + (coinsEarned >= 300 ? 1 : 0),
          transactions: [tx, ...s.transactions].slice(0, 50),
        });
      },

      applyServerAdReward: (reward, walletCoins) => {
        const s = get();
        const tx: Transaction = {
          id: makeId(),
          type: 'ad',
          amount: reward,
          label: 'txAdReward',
          createdAt: Date.now(),
        };
        set({
          coins: Math.max(0, walletCoins),
          coinsEarnedThisMonth: s.coinsEarnedThisMonth + Math.max(0, reward),
          transactions: [tx, ...s.transactions].slice(0, 50),
        });
      },

      applyServerTaskReward: (reward, walletCoins, taskId) => {
        const s = get();
        const tx: Transaction = {
          id: makeId(),
          type: 'task',
          amount: reward,
          label: 'txTaskReward',
          createdAt: Date.now(),
          meta: { taskId },
        };
        set({
          coins: Math.max(0, walletCoins),
          tasks: s.tasks.map((task) => task.id === taskId ? { ...task, claimed: true } : task),
          coinsEarnedThisMonth: s.coinsEarnedThisMonth + Math.max(0, reward),
          transactions: [tx, ...s.transactions].slice(0, 50),
        });
      },

      syncServerWalletCoins: (walletCoins) => set({ coins: Math.max(0, walletCoins) }),

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

      // Create a withdrawal request only after the server confirms the one-time TON fee payment.
      // On success, the server locks the requested game coins for manual review.
      requestWithdrawal: async (units, tonAddress, feePaymentId) => {
        const s = get();
        const coins = units * COINS_PER_USD;
        try {
          const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData ?? '' : '';
          if (!initData) return { ok: false, error: 'telegram_auth_required' };
          const idempotencyKey = feePaymentId;
          const requestBody = JSON.stringify({ units, tonAddress, idempotencyKey, feePaymentId });
          let res: Response | undefined;
          // Retry once with the same key if the connection drops after the
          // server may already have committed the withdrawal.
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              res = await fetch('/api/withdrawals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
                body: requestBody,
              });
              break;
            } catch (error) {
              if (attempt === 1) throw error;
            }
          }
          if (!res) return { ok: false, error: 'network_error' };
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
      syncAdminState: async (initData) => {
        if (!initData) return;
        try {
          const response = await fetch('/api/players/me', { headers: { 'X-Telegram-Init-Data': initData }, cache: 'no-store' });
          if (!response.ok) return;
          const data = await response.json() as { parts?: Record<string, number>; specialParts?: Record<string, {owned?:boolean;expiresAt?:number|null}>; gameSettings?: { baseOilPerTap?: number; baseCapacity?: number } | null };
          const parts = data.parts ?? {};
          const baseRate = Number(data.gameSettings?.baseOilPerTap ?? baseOilPerTap);
          const capacity = Number(data.gameSettings?.baseCapacity ?? baseCapacity);
          const special = data.specialParts ?? {};
          set({
            parts: {
              oil_pump: Math.max(0, Number(parts.oil_pump ?? 0)),
              fuel_station: Math.max(0, Number(parts.fuel_station ?? 0)),
              oil_truck: Math.max(0, Number(parts.oil_truck ?? 0)),
            },
            specialParts: {
              new_background: special.new_background?.owned === true,
              vip_badge: special.vip_badge?.owned === true,
              wheel_expansion_until: special.wheel_expansion?.expiresAt ?? null,
            },
            baseOilPerTap: Number.isFinite(baseRate) && baseRate >= 1 ? baseRate : baseOilPerTap,
            baseCapacity: Number.isFinite(capacity) && capacity >= 1 ? capacity : baseCapacity,
          });
        } catch { /* Retry at the next cloud sync interval. */ }
      },

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
          // Withdrawal history is authoritative here, but the legacy gameplay
          // balance is not yet ledger-backed. Never overwrite it with a stale
          // zero wallet returned by the withdrawal endpoint.
          set({ withdrawals: data.withdrawals });
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
        languagePreferenceSet: s.languagePreferenceSet,
        onboarded: s.onboarded,
        acceptedDisclaimer: s.acceptedDisclaimer,
        oil: s.oil,
        coins: s.coins,
        upgrades: s.upgrades,
        tasks: s.tasks,
        referrals: s.referrals,
        transactions: s.transactions,
        parts: s.parts,
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

export function effectiveCapacity(upgrades: UpgradeRecord[], base: number = baseCapacity, now: number = Date.now(), stationParts = 0): number {
  return base + filterActiveUpgrades(upgrades, now).length * 250 + Math.max(0, stationParts) * 250;
}

export function effectiveOilPerTap(upgrades: UpgradeRecord[], now: number = Date.now(), base: number = baseOilPerTap): number {
  return base + filterActiveUpgrades(upgrades, now).reduce((acc, u) => {
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
