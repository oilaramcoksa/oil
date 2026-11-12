// Tournaments, prizes, and one-shot achievements.
//
// Prizes are credited as in-game coins. Coins can be withdrawn in TON
// (100,000 coins = 1 USD) through the wallet's withdrawal section, which
// creates a request that is manually reviewed (see lib/withdraw.ts).
//
// Prizes are distributed by SKILL (coins earned through active play:
// selling oil, completing tasks, referring friends) — NOT by how much
// a user deposited. Buying upgrades speeds up earning potential but
// doesn't directly count toward the leaderboard.

export interface PrizeTier {
  rank: number;           // 1-5
  coins: number;          // game coins credited to winner
  usdEquivalent: number;  // informational only — production intent
  icon: string;           // medal emoji
  color: string;          // tailwind gradient
  label: string;          // "1st", "2nd"...
  labelAr: string;
  labelEn: string;
  labelRu: string;
}

// Prize structure as specified by the user (monthly tournament).
export const PRIZE_STRUCTURE: PrizeTier[] = [
  {
    rank: 1,
    coins: 2_000_000,
    usdEquivalent: 200,
    icon: '🥇',
    color: 'from-yellow-400 to-amber-500',
    label: '1st',
    labelAr: 'الأول',
    labelEn: '1st',
    labelRu: '1-е',
  },
  {
    rank: 2,
    coins: 1_000_000,
    usdEquivalent: 100,
    icon: '🥈',
    color: 'from-gray-300 to-gray-400',
    label: '2nd',
    labelAr: 'الثاني',
    labelEn: '2nd',
    labelRu: '2-е',
  },
  {
    rank: 3,
    coins: 500_000,
    usdEquivalent: 50,
    icon: '🥉',
    color: 'from-orange-400 to-orange-600',
    label: '3rd',
    labelAr: 'الثالث',
    labelEn: '3rd',
    labelRu: '3-е',
  },
  {
    rank: 4,
    coins: 250_000,
    usdEquivalent: 25,
    icon: '🎖️',
    color: 'from-sky-400 to-blue-500',
    label: '4th',
    labelAr: 'الرابع',
    labelEn: '4th',
    labelRu: '4-е',
  },
  {
    rank: 5,
    coins: 150_000,
    usdEquivalent: 15,
    icon: '🎖️',
    color: 'from-emerald-400 to-teal-500',
    label: '5th',
    labelAr: 'الخامس',
    labelEn: '5th',
    labelRu: '5-е',
  },
];

export const TOTAL_PRIZE_POOL_USD = PRIZE_STRUCTURE.reduce(
  (acc, p) => acc + p.usdEquivalent,
  0
); // 390
export const TOTAL_PRIZE_POOL_COINS = PRIZE_STRUCTURE.reduce(
  (acc, p) => acc + p.coins,
  0
); // 3,900,000

// Percentage of store revenue allocated to the prize pool.
export const PRIZE_FUND_PERCENT = 50;

export interface Achievement {
  id: string;
  threshold: number;        // coins/taps/sells count to unlock
  metric: 'coins' | 'taps' | 'sells' | 'referrals';
  reward: number;           // game coins bonus
  titleAr: string;
  titleEn: string;
  titleRu: string;
  descAr: string;
  descEn: string;
  descRu: string;
  icon: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'coins_100k',
    threshold: 100_000,
    metric: 'coins',
    reward: 5_000,
    titleAr: 'خط 100 ألف',
    titleEn: '100K milestone',
    titleRu: '100K достижение',
    descAr: 'اجمع 100,000 عملة',
    descEn: 'Collect 100,000 coins',
    descRu: 'Собери 100 000 монет',
    icon: '💰',
  },
  {
    id: 'coins_1m',
    threshold: 1_000_000,
    metric: 'coins',
    reward: 50_000,
    titleAr: 'خط المليون',
    titleEn: 'Millionaire',
    titleRu: 'Миллионер',
    descAr: 'اجمع 1,000,000 عملة',
    descEn: 'Collect 1,000,000 coins',
    descRu: 'Собери 1 000 000 монет',
    icon: '💎',
  },
  {
    id: 'coins_5m',
    threshold: 5_000_000,
    metric: 'coins',
    reward: 250_000,
    titleAr: 'أباطرة البترول',
    titleEn: 'Oil baron',
    titleRu: 'Нефтяной барон',
    descAr: 'اجمع 5,000,000 عملة',
    descEn: 'Collect 5,000,000 coins',
    descRu: 'Собери 5 000 000 монет',
    icon: '👑',
  },
  {
    id: 'taps_1000',
    threshold: 1_000,
    metric: 'taps',
    reward: 1_000,
    titleAr: 'مضخة نشيطة',
    titleEn: 'Active pumper',
    titleRu: 'Активный насос',
    descAr: 'اضغط المضخة 1000 مرة',
    descEn: 'Tap the pump 1000 times',
    descRu: 'Нажми на насос 1000 раз',
    icon: '⚡',
  },
  {
    id: 'taps_10000',
    threshold: 10_000,
    metric: 'taps',
    reward: 10_000,
    titleAr: 'ماستر الضخ',
    titleEn: 'Pump master',
    titleRu: 'Мастер насоса',
    descAr: 'اضغط المضخة 10,000 مرة',
    descEn: 'Tap the pump 10,000 times',
    descRu: 'Нажми на насос 10 000 раз',
    icon: '🔧',
  },
  {
    id: 'sells_100',
    threshold: 100,
    metric: 'sells',
    reward: 5_000,
    titleAr: 'تاجر براميل',
    titleEn: 'Barrel trader',
    titleRu: 'Торговец бочками',
    descAr: 'بِع البترول 100 مرة',
    descEn: 'Sell oil 100 times',
    descRu: 'Продай нефть 100 раз',
    icon: '🛢️',
  },
];

// === Mock leaderboard ===
// Deterministic fake competitors so the leaderboard feels stable.
// In production, this would be real player data from a backend.

const MOCK_NAMES_AR = [
  'أحمد', 'سارة', 'عمر', 'ليلى', 'يوسف', 'مريم', 'خالد', 'نور',
  'محمد', 'فاطمة', 'علي', 'هدى', 'حسن', 'زينب', 'كريم', 'رنا',
  'طارق', 'سلمى', 'باسم', 'دعاء', 'وليد', 'إيمان', 'مازن', 'رحاب',
];

// Deterministic pseudo-random based on month + index
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  coinsEarned: number;       // this month
  isUser: boolean;
  prize?: PrizeTier;         // for top 5
}

export function getMonthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function generateMockLeaderboard(
  userCoinsEarned: number,
  userName: string,
  monthKey: string
): LeaderboardEntry[] {
  // Use monthKey to seed so the mock data is stable within a month
  const seedBase = monthKey
    .split('')
    .reduce((acc, c) => acc + c.charCodeAt(0), 0);

  // Generate ~24 fake competitors with decreasing coins earned
  const competitors = MOCK_NAMES_AR.map((name, i) => {
    const seed = seedBase + i * 17;
    // Top players have higher scores; spread is 4M down to 50K
    const base = 4_000_000 - i * 150_000;
    const jitter = (seededRandom(seed) - 0.5) * 200_000;
    const coinsEarned = Math.max(50_000, Math.round(base + jitter));
    return { name, coinsEarned, isUser: false };
  });

  // Insert the user
  const userEntry = { name: userName, coinsEarned: userCoinsEarned, isUser: true };
  const all = [...competitors, userEntry];

  // Sort descending by coins earned
  all.sort((a, b) => b.coinsEarned - a.coinsEarned);

  // Build entries with rank + prize for top 5
  return all.map((entry, idx) => {
    const rank = idx + 1;
    const prize = rank <= 5 ? PRIZE_STRUCTURE[rank - 1] : undefined;
    return { ...entry, rank, prize };
  });
}

// === Time helpers ===

// Get the Date for the 1st of next month at 00:00 local time.
export function getNextMonthStart(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0);
}

// Seconds remaining until next month starts.
export function secondsUntilNextMonth(d: Date = new Date()): number {
  const next = getNextMonthStart(d);
  return Math.max(0, Math.floor((next.getTime() - d.getTime()) / 1000));
}

// Format seconds as DD:HH:MM:SS for the countdown.
export function formatLongCountdown(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(days)}:${pad(hours)}:${pad(mins)}:${pad(sec)}`;
}
