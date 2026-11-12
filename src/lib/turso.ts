import { createClient, type Client } from '@libsql/client';

let client: Client | undefined;
let initialized: Promise<void> | undefined;

export function getTurso(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error('turso_not_configured');
  if (!client) client = createClient({ url, authToken });
  return client;
}

export async function ensurePlayerSchema(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = getTurso();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS players (
          telegram_id TEXT PRIMARY KEY,
          username TEXT,
          first_name TEXT,
          last_name TEXT,
          referral_code TEXT NOT NULL UNIQUE,
          referred_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS player_monthly_stats (
          telegram_id TEXT NOT NULL,
          month_key TEXT NOT NULL,
          taps INTEGER NOT NULL DEFAULT 0,
          sells INTEGER NOT NULL DEFAULT 0,
          coins_earned INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (telegram_id, month_key),
          FOREIGN KEY (telegram_id) REFERENCES players(telegram_id)
        )`,
        `CREATE TABLE IF NOT EXISTS player_events (
          id TEXT PRIMARY KEY,
          telegram_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          amount INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (telegram_id) REFERENCES players(telegram_id)
        )`,
        `CREATE TABLE IF NOT EXISTS referrals (
          id TEXT PRIMARY KEY,
          referrer_telegram_id TEXT NOT NULL,
          referee_telegram_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'joined',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (referrer_telegram_id) REFERENCES players(telegram_id),
          FOREIGN KEY (referee_telegram_id) REFERENCES players(telegram_id),
          CHECK (referrer_telegram_id <> referee_telegram_id)
        )`,
        'CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen_at)',
        'CREATE INDEX IF NOT EXISTS idx_monthly_stats_rank ON player_monthly_stats(month_key, coins_earned DESC)',
        'CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_telegram_id)',
      ], 'write');
    })().catch((error) => {
      initialized = undefined;
      throw error;
    });
  }
  return initialized;
}
