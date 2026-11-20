import { getTurso } from '@/lib/turso';

export async function ensurePromoSchema() {
  const db = getTurso();
  await db.execute(`CREATE TABLE IF NOT EXISTS promo_codes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    promo_type TEXT NOT NULL CHECK(promo_type IN ('mining_fee','free_part','free_package','coins')),
    product_id TEXT,
    reward_coins INTEGER NOT NULL DEFAULT 0 CHECK(reward_coins>=0),
    per_user_limit INTEGER NOT NULL DEFAULT 1 CHECK(per_user_limit>=1),
    total_limit INTEGER,
    total_uses INTEGER NOT NULL DEFAULT 0 CHECK(total_uses>=0),
    starts_at TEXT,
    expires_at TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS promo_redemptions (
    id TEXT PRIMARY KEY,
    promo_id TEXT NOT NULL REFERENCES promo_codes(id),
    telegram_id TEXT NOT NULL REFERENCES players(telegram_id),
    reward_type TEXT NOT NULL,
    reward_product_id TEXT,
    reward_amount INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(promo_id,telegram_id,id)
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_promo_redemptions_player ON promo_redemptions(promo_id,telegram_id)');
}
