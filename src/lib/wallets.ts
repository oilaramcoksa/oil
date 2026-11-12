// Wallet addresses for crypto upgrades (provided by the user).
// Users pay real crypto to buy in-game upgrades (speed boosts).
// Game coins can be withdrawn in TON (100,000 coins = 1 USD) through the
// withdrawal section of the wallet screen — see lib/withdraw.ts.

export interface CryptoWallet {
  code: 'gram' | 'bnb' | 'tron' | 'btc';
  label: string;
  labelAr: string;
  labelRu: string;
  network: string;
  address: string;
  icon: string; // emoji placeholder; replace with proper SVG if desired
  accent: string; // tailwind color class
}

export const WALLETS: CryptoWallet[] = [
  {
    code: 'gram',
    label: 'GRAM',
    labelAr: 'جرام',
    labelRu: 'GRAM',
    network: 'GRAM Network',
    address: 'UQAcwdRaN8kD06qJtZxlNnxTkTA46Xz1ROVYB_m-T7okBEJO',
    icon: '⚡',
    accent: 'from-sky-400 to-blue-500',
  },
  {
    code: 'bnb',
    label: 'BNB',
    labelAr: 'BNB',
    labelRu: 'BNB',
    network: 'BEP-20',
    address: '0x0E545e65344C96b345d33475DD2FddEEd9A2a1Dc',
    icon: '🟡',
    accent: 'from-yellow-400 to-amber-500',
  },
  {
    code: 'tron',
    label: 'TRON',
    labelAr: 'ترون',
    labelRu: 'TRON',
    network: 'TRC-20',
    address: 'TYRFYJsKPgeGyT685iqdpfqhNNYw2eMKFK',
    icon: '🔴',
    accent: 'from-red-500 to-rose-600',
  },
  {
    code: 'btc',
    label: 'Bitcoin',
    labelAr: 'بيتكوين',
    labelRu: 'Bitcoin',
    network: 'Bitcoin Network',
    address: 'bc1q5wtrqzl2j00wc80fhvur6hm9wqkjhn4pvntmne',
    icon: '₿',
    accent: 'from-orange-400 to-orange-600',
  },
];

// Upgrade packages: ONE-WAY purchases, valid for 30 DAYS from purchase.
// Numbers shown are in-game speed points only — there is NO promise of
// USD returns or monthly/annual "profit" in real currency.
// Speed points only affect in-game oil production rate.
//
// Internal tuning guidance (DO NOT display these in the game):
//   - super_oil: ~2M coins over 30 days  → perHour ≈ 2777
//   - king_oil:  ~2M coins over 45 days  → perHour ≈ 1851
//   - fast_oil:  ~2M coins over 60 days  → perHour ≈ 1388
// These rates are SILENTLY tuned; users only see the perHour number.
//
// !! PAYOUT LIABILITY — now that coins are withdrawable at 100,000 = $1,
// ~2M coins is ~$20 of payout liability per package, while the package
// itself costs $3 / $10 / $25. Re-tune perHour (or the withdrawal rate) so
// that the maximum payout per package stays comfortably BELOW its price,
// otherwise withdrawals can only be funded by new players' purchases.

export const UPGRADE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface UpgradePackage {
  id: 'super_oil' | 'king_oil' | 'fast_oil';
  priceUSD: number;       // display only — actual payment is in chosen crypto
  speedBase: number;      // base speed points (in-game only)
  bonusPct: number;       // e.g. 25 for +25%
  oilPerTap: number;      // oil drops produced per tap with this tier
  perHour: number;        // passive coin/hour rate (informational)
  color: string;          // gradient classes
  badge: string;          // "Best value" etc.
}

export const PACKAGES: UpgradePackage[] = [
  {
    id: 'fast_oil',
    priceUSD: 3,
    speedBase: 60000,
    bonusPct: 25,
    oilPerTap: 6,
    perHour: 1388,
    color: 'from-emerald-400 to-teal-500',
    badge: '',
  },
  {
    id: 'king_oil',
    priceUSD: 10,
    speedBase: 120000,
    bonusPct: 25,
    oilPerTap: 12,
    perHour: 1851,
    color: 'from-amber-400 to-orange-500',
    badge: 'popular',
  },
  {
    id: 'super_oil',
    priceUSD: 25,
    speedBase: 200000,
    bonusPct: 25,
    oilPerTap: 25,
    perHour: 2777,
    color: 'from-fuchsia-500 to-purple-600',
    badge: 'best',
  },
];

export function packageTotal(p: UpgradePackage): number {
  return Math.round(p.speedBase * (1 + p.bonusPct / 100));
}
