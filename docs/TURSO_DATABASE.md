# Aramco Oil — Turso database

Turso is the application database. The app uses the `@libsql/client` driver and reads credentials only from server environment variables:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

Never expose `TURSO_AUTH_TOKEN` through a `NEXT_PUBLIC_*` variable or commit it to Git.

## Schema domains

| Domain | Tables | Purpose |
|---|---|---|
| Identity | `players` | Telegram identity, referral code, account status |
| Wallet | `player_wallets`, `ledger_entries` | Balances and immutable accounting history |
| Game state | `player_game_state`, `player_events` | Pump cycle, game events, idempotency |
| Analytics | `player_daily_stats`, `player_weekly_stats`, `player_monthly_stats` | Time-bucketed player metrics and leaderboard |
| Engagement | `referrals`, `task_claims`, `achievement_claims` | Invitations and one-time reward claims |
| Monetization | `payment_transactions`, `player_upgrades`, `withdrawal_requests` | Payment verification, entitlements and payout requests |
| Governance | `tournament_results`, `admin_audit_logs`, `app_settings` | Monthly results, admin trace and settings |

## Schema initialization

The first authenticated player/leaderboard/withdrawal API request runs versioned, additive schema setup. It preserves the existing player, monthly-stat, event and referral rows, adds missing columns, and creates the additional tables and indexes. It also backfills wallet and game-state rows for existing registered players.

No existing local SQLite data is copied automatically. The old Prisma SQLite withdrawal history is not imported by this schema step.

## Security and accounting rules

1. Telegram identity must be verified from signed, fresh Mini App initData on the server.
2. A browser balance or client counter is not an accounting source.
3. Every balance mutation must be a server-side transaction with an idempotency key and a matching immutable ledger entry.
4. Referral rewards require server-verified qualification; a referral join alone is not a paid reward.
5. Payment status must be verified against the relevant provider/network before granting an upgrade.
6. Withdrawals stay disabled until wallet balances and the ledger are server-authoritative.
7. Admin changes must be authenticated and written to `admin_audit_logs`.

## Operational endpoints

- `GET /api/admin/database/overview` returns live aggregate counts from Turso and requires `Authorization: Bearer <ADMIN_TOKEN>`.
- `postLedgerEntry` in `src/lib/ledger.ts` is the server-only primitive for atomic, idempotent wallet balance changes. It records an immutable ledger row and updates coin-earned time buckets when crediting coins. Gameplay routes must validate the event before calling it.

## Current implementation boundary

This PR establishes the relational schema and moves withdrawal-history reads/admin status storage from Prisma SQLite to Turso. It does not yet migrate every game action out of Zustand/localStorage, and it does not enable payouts or automatic referral rewards. Those require the server-side game/ledger service and verified payment callbacks.
