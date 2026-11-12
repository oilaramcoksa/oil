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

const MIGRATIONS: Array<{ version: number; statements: string[] }> = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS players (
        telegram_id TEXT PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        referral_code TEXT NOT NULL UNIQUE,
        referred_by TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','deleted')),
        locale TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS player_wallets (
        telegram_id TEXT PRIMARY KEY REFERENCES players(telegram_id) ON DELETE CASCADE,
        oil_balance INTEGER NOT NULL DEFAULT 0 CHECK(oil_balance >= 0),
        coins_balance INTEGER NOT NULL DEFAULT 0 CHECK(coins_balance >= 0),
        coins_locked INTEGER NOT NULL DEFAULT 0 CHECK(coins_locked >= 0),
        lifetime_coins_earned INTEGER NOT NULL DEFAULT 0 CHECK(lifetime_coins_earned >= 0),
        lifetime_oil_sold INTEGER NOT NULL DEFAULT 0 CHECK(lifetime_oil_sold >= 0),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS player_game_state (
        telegram_id TEXT PRIMARY KEY REFERENCES players(telegram_id) ON DELETE CASCADE,
        base_oil_per_tap INTEGER NOT NULL DEFAULT 2,
        base_capacity INTEGER NOT NULL DEFAULT 500,
        cycle_started_at INTEGER,
        cycle_ends_at INTEGER,
        last_tick_at INTEGER,
        last_login_day TEXT,
        login_streak INTEGER NOT NULL DEFAULT 0,
        last_daily_reset TEXT,
        last_weekly_reset TEXT,
        last_monthly_reset TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS player_events (
        id TEXT PRIMARY KEY,
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        idempotency_key TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS ledger_entries (
        id TEXT PRIMARY KEY,
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
        asset TEXT NOT NULL CHECK(asset IN ('coins','oil')),
        entry_type TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK(amount <> 0),
        balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
        reference_type TEXT,
        reference_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS player_daily_stats (
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
        day_key TEXT NOT NULL,
        taps INTEGER NOT NULL DEFAULT 0,
        sells INTEGER NOT NULL DEFAULT 0,
        oil_sold INTEGER NOT NULL DEFAULT 0,
        coins_earned INTEGER NOT NULL DEFAULT 0,
        tasks_completed INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(telegram_id, day_key)
      )`,
      `CREATE TABLE IF NOT EXISTS player_monthly_stats (
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
        month_key TEXT NOT NULL,
        taps INTEGER NOT NULL DEFAULT 0,
        sells INTEGER NOT NULL DEFAULT 0,
        oil_sold INTEGER NOT NULL DEFAULT 0,
        coins_earned INTEGER NOT NULL DEFAULT 0,
        coins_spent INTEGER NOT NULL DEFAULT 0,
        referrals INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(telegram_id, month_key)
      )`,
      `CREATE TABLE IF NOT EXISTS player_weekly_stats (
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
        week_key TEXT NOT NULL,
        taps INTEGER NOT NULL DEFAULT 0,
        sells INTEGER NOT NULL DEFAULT 0,
        oil_sold INTEGER NOT NULL DEFAULT 0,
        coins_earned INTEGER NOT NULL DEFAULT 0,
        referrals INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(telegram_id, week_key)
      )`,
      `CREATE TABLE IF NOT EXISTS referrals (
        id TEXT PRIMARY KEY,
        referrer_telegram_id TEXT NOT NULL REFERENCES players(telegram_id),
        referee_telegram_id TEXT NOT NULL UNIQUE REFERENCES players(telegram_id),
        status TEXT NOT NULL DEFAULT 'joined' CHECK(status IN ('joined','qualified','rewarded','rejected')),
        reward_coins INTEGER NOT NULL DEFAULT 0,
        qualified_at TEXT,
        rewarded_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK(referrer_telegram_id <> referee_telegram_id)
      )`,
      `CREATE TABLE IF NOT EXISTS task_claims (
        id TEXT PRIMARY KEY,
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        period_key TEXT NOT NULL,
        reward_coins INTEGER NOT NULL DEFAULT 0,
        claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(telegram_id, task_id, period_key)
      )`,
      `CREATE TABLE IF NOT EXISTS achievement_claims (
        id TEXT PRIMARY KEY,
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
        achievement_id TEXT NOT NULL,
        reward_coins INTEGER NOT NULL DEFAULT 0,
        claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(telegram_id, achievement_id)
      )`,
      `CREATE TABLE IF NOT EXISTS player_upgrades (
        id TEXT PRIMARY KEY,
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
        package_id TEXT NOT NULL,
        payment_id TEXT,
        purchased_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending','active','expired','revoked'))
      )`,
      `CREATE TABLE IF NOT EXISTS payment_transactions (
        id TEXT PRIMARY KEY,
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id),
        provider TEXT NOT NULL,
        asset TEXT NOT NULL,
        network TEXT NOT NULL,
        amount TEXT NOT NULL,
        tx_hash TEXT,
        package_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected','expired')),
        provider_payload_json TEXT,
        confirmed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, network, tx_hash)
      )`,
      `CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id TEXT PRIMARY KEY,
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id),
        units INTEGER NOT NULL CHECK(units > 0),
        coins INTEGER NOT NULL CHECK(coins > 0),
        ton_address TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','rejected')),
        tx_hash TEXT,
        admin_note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS tournament_results (
        id TEXT PRIMARY KEY,
        month_key TEXT NOT NULL,
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id),
        rank INTEGER NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        prize_coins INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'calculated' CHECK(status IN ('calculated','approved','credited','cancelled')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(month_key, telegram_id),
        UNIQUE(month_key, rank)
      )`,
      `CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        details_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS app_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      'CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen_at)',
      'CREATE INDEX IF NOT EXISTS idx_events_player_time ON player_events(telegram_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_ledger_player_time ON ledger_entries(telegram_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_ledger_reference ON ledger_entries(reference_type, reference_id)',
      'CREATE INDEX IF NOT EXISTS idx_daily_stats_day ON player_daily_stats(day_key)',
      'CREATE INDEX IF NOT EXISTS idx_monthly_stats_rank ON player_monthly_stats(month_key, coins_earned DESC)',
      'CREATE INDEX IF NOT EXISTS idx_weekly_stats_rank ON player_weekly_stats(week_key, coins_earned DESC)',
      'CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_telegram_id, status)',
      'CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawal_requests(status, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_payments_player ON payment_transactions(telegram_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_upgrades_player_expiry ON player_upgrades(telegram_id, expires_at)',
      `CREATE TRIGGER IF NOT EXISTS ledger_entries_no_update
        BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'ledger_entries_are_immutable'); END`,
      `CREATE TRIGGER IF NOT EXISTS ledger_entries_no_delete
        BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'ledger_entries_are_immutable'); END`,
    ],
  },
];

export async function ensureDatabaseSchema(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = getTurso();
      await db.execute('PRAGMA foreign_keys = ON');
      await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      const applied = await db.execute('SELECT version FROM schema_migrations');
      const versions = new Set(applied.rows.map((row) => Number(row.version)));
      for (const migration of MIGRATIONS) {
        if (versions.has(migration.version)) continue;
        await db.batch(migration.statements, 'write');
        await db.execute({
          sql: 'INSERT INTO schema_migrations(version) VALUES (?)',
          args: [migration.version],
        });
      }
      const legacyColumns: Array<[string, string, string]> = [
        ['players', 'status', "TEXT NOT NULL DEFAULT 'active'"],
        ['players', 'locale', 'TEXT'],
        ['player_events', 'metadata_json', 'TEXT'],
        ['player_events', 'idempotency_key', 'TEXT'],
        ['player_monthly_stats', 'oil_sold', 'INTEGER NOT NULL DEFAULT 0'],
        ['player_monthly_stats', 'coins_spent', 'INTEGER NOT NULL DEFAULT 0'],
        ['player_monthly_stats', 'referrals', 'INTEGER NOT NULL DEFAULT 0'],
        ['referrals', 'reward_coins', 'INTEGER NOT NULL DEFAULT 0'],
        ['referrals', 'qualified_at', 'TEXT'],
        ['referrals', 'rewarded_at', 'TEXT'],
      ];
      for (const [table, column, definition] of legacyColumns) {
        const info = await db.execute(`PRAGMA table_info(${table})`);
        if (!info.rows.some((row) => row.name === column)) {
          await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
      }
      await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_player_events_idempotency ON player_events(idempotency_key)');

      // Backfill wallet and game-state rows for all players registered before this schema.
      await db.execute(`INSERT OR IGNORE INTO player_wallets(telegram_id)
        SELECT telegram_id FROM players`);
      await db.execute(`INSERT OR IGNORE INTO player_game_state(telegram_id)
        SELECT telegram_id FROM players`);
      await db.execute(`INSERT OR IGNORE INTO player_monthly_stats(telegram_id, month_key)
        SELECT telegram_id, strftime('%Y-%m','now') FROM players`);
    })().catch((error) => {
      initialized = undefined;
      throw error;
    });
  }
  return initialized;
}

/** Backwards-compatible alias used by existing player endpoints. */
export const ensurePlayerSchema = ensureDatabaseSchema;
