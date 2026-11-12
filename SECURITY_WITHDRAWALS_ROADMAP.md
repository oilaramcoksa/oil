# Security status: withdrawals and player balances

## Current safeguard
- Withdrawal history is scoped to the Telegram account proven by signed initData in the X-Telegram-Init-Data request header.
- The API derives the account key as tg_<telegram-user-id>; it does not accept a caller-selected user ID.
- Creating a withdrawal currently returns HTTP 503 by design. The browser's localStorage balance is client-controlled and must never authorize a real-money payout.

## Required before enabling payouts
1. Replace the client-only Zustand/localStorage economy with a server-authoritative ledger.
2. Persist Telegram users with a unique Telegram ID and bind every balance, task claim, referral, upgrade and transaction to that ID.
3. Implement atomic, idempotent server operations for mining, selling, task claims, referral rewards and tournament awards.
4. Calculate withdrawal eligibility from the ledger inside a database transaction; reserve/deduct coins atomically and enforce one pending request per user.
5. Reconcile historical client balances and pending withdrawals. Never import a browser-supplied balance as trusted funds.
6. Add rate limits, audit events, admin review controls, and tests for replay, race conditions and cross-account access.
7. Enable withdrawals only after deployment, migration, security review and end-to-end tests.

## Telegram header
The client must send the raw Telegram.WebApp.initData as X-Telegram-Init-Data. It is verified server-side using TELEGRAM_BOT_TOKEN. Do not send initDataUnsafe or the bot token to the browser.