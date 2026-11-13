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
    version: 2,
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
  {
    version: 3,
    statements: [
      `CREATE TABLE IF NOT EXISTS player_game_snapshots (
        telegram_id TEXT PRIMARY KEY REFERENCES players(telegram_id) ON DELETE CASCADE,
        state_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      'CREATE INDEX IF NOT EXISTS idx_game_snapshots_updated ON player_game_snapshots(updated_at)',
    ],
  },
  {
    version: 4,
    statements: [
      `CREATE TABLE IF NOT EXISTS arena_rounds (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('open','countdown','spinning','completed','cancelled')),
        starts_at INTEGER,
        spin_started_at INTEGER,
        ends_at INTEGER,
        total_entries INTEGER NOT NULL DEFAULT 0,
        winner_telegram_id TEXT,
        winner_type TEXT CHECK(winner_type IN ('player','house')),
        winning_amount INTEGER NOT NULL DEFAULT 0,
        outcome_seed TEXT,
        wheel_stop_degrees REAL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS arena_entries (
        id TEXT PRIMARY KEY,
        round_id TEXT NOT NULL REFERENCES arena_rounds(id),
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id),
        amount INTEGER NOT NULL CHECK(amount >= 1000),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(round_id, telegram_id)
      )`,
      'CREATE INDEX IF NOT EXISTS idx_arena_round_status ON arena_rounds(status, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_arena_entries_round ON arena_entries(round_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_arena_entries_player ON arena_entries(telegram_id, created_at)',
    ],
  },
  {
    version: 5,
    statements: [
      `CREATE TABLE IF NOT EXISTS coin_swaps (
        id TEXT PRIMARY KEY,
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id),
        coins INTEGER NOT NULL CHECK(coins > 0),
        usd_micros INTEGER NOT NULL CHECK(usd_micros > 0),
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS usdt_withdrawal_requests (
        id TEXT PRIMARY KEY,
        telegram_id TEXT NOT NULL REFERENCES players(telegram_id),
        usd_micros INTEGER NOT NULL CHECK(usd_micros >= 1000000),
        tron_address TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','rejected')),
        tx_hash TEXT,
        admin_note TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      'CREATE INDEX IF NOT EXISTS idx_usdt_withdrawals_player ON usdt_withdrawal_requests(telegram_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_usdt_withdrawals_status ON usdt_withdrawal_requests(status, created_at)',
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
          sql: 'INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)',
          args: [migration.version],
        });
      }
      const legacyColumns: Array<[string, string, string]> = [
        ['player_wallets', 'usd_micros', 'INTEGER NOT NULL DEFAULT 0'],
        ['player_wallets', 'usd_locked_micros', 'INTEGER NOT NULL DEFAULT 0'],
        ['players', 'status', "TEXT NOT NULL DEFAULT 'active'"],
        ['players', 'locale', 'TEXT'],
        ['players', 'photo_url', 'TEXT'],
        ['player_events', 'metadata_json', 'TEXT'],
        ['player_events', 'idempotency_key', 'TEXT'],
        ['player_monthly_stats', 'oil_sold', 'INTEGER NOT NULL DEFAULT 0'],
        ['player_monthly_stats', 'coins_spent', 'INTEGER NOT NULL DEFAULT 0'],
        ['player_monthly_stats', 'referrals', 'INTEGER NOT NULL DEFAULT 0'],
        ['referrals', 'reward_coins', 'INTEGER NOT NULL DEFAULT 0'],
        ['referrals', 'qualified_at', 'TEXT'],
        ['referrals', 'rewarded_at', 'TEXT'],
        ['withdrawal_requests', 'idempotency_key', 'TEXT'],
      ];
      for (const [table, column, definition] of legacyColumns) {
        const info = await db.execute(`PRAGMA table_info(${table})`);
        if (!info.rows.some((row) => row.name === column)) {
          await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
      }
      await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_player_events_idempotency ON player_events(idempotency_key)');
      await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawal_idempotency ON withdrawal_requests(telegram_id, idempotency_key)');

      // Backfill wallet and game-state rows for all players registered before this schema.
      await db.execute(`INSERT OR IGNORE INTO player_wallets(telegram_id)
        SELECT telegram_id FROM players`);
      // Restore legacy wallet balances from the last cloud snapshot before
      // treating newly backfilled zero-balance wallet rows as authoritative.
      // Never overwrite balances once a ledger entry or swap exists.
      await db.execute(`
        UPDATE player_wallets
        SET coins_balance = COALESCE((
              SELECT CAST(json_extract(s.state_json, '$.coins') AS INTEGER)
              FROM player_game_snapshots s
              WHERE s.telegram_id = player_wallets.telegram_id
                AND json_valid(s.state_json)
                AND json_type(s.state_json, '$.coins') IN ('integer','real')
                AND CAST(json_extract(s.state_json, '$.coins') AS INTEGER) >= 0
            ), coins_balance),
            oil_balance = COALESCE((
              SELECT CAST(json_extract(s.state_json, '$.oil') AS INTEGER)
              FROM player_game_snapshots s
              WHERE s.telegram_id = player_wallets.telegram_id
                AND json_valid(s.state_json)
                AND json_type(s.state_json, '$.oil') IN ('integer','real')
                AND CAST(json_extract(s.state_json, '$.oil') AS INTEGER) >= 0
            ), oil_balance),
            updated_at = CURRENT_TIMESTAMP
        WHERE NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.telegram_id = player_wallets.telegram_id)
          AND NOT EXISTS (SELECT 1 FROM coin_swaps s WHERE s.telegram_id = player_wallets.telegram_id)
          AND EXISTS (SELECT 1 FROM player_game_snapshots s WHERE s.telegram_id = player_wallets.telegram_id)
      `);
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
