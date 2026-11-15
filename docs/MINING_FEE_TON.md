# ARMCO OIL — One-time TON mining activation fee

## Behavior
- Default: every player must pay exactly 0.1 TON once for the lifetime of the account before starting their first mining cycle.
- Admin may exempt an individual Telegram player ID; exempt players bypass the fee.
- A confirmed 0.1 TON payment or admin exemption is permanent for that account.
- The connected TON wallet address is stored on the authenticated player record in Turso. TON Connect may still request wallet approval again on a different browser or device.
- The pump and game load normally; the fee notice appears only when the player first attempts to start mining.
- Jetton launch is intentionally not part of this change. The game token can be created and published later.

## Required deployment variables
- `TON_MINING_FEE_WALLET`: optional receiving TON Mainnet wallet override. If omitted, the existing TON address in `src/lib/wallets.ts` is used.
- `TONCENTER_API_KEY`: recommended TON Center API key for transaction lookup.
- `TONCENTER_API_URL`: optional, defaults to `https://toncenter.com/api/v2`.
- `NEXT_PUBLIC_APP_URL`: canonical public app origin used by the TON Connect manifest. Configure this to the production Telegram Mini App origin; the current fallback is `https://armcooil.com`.

Do not put private keys, seed phrases, or API secrets in client-side variables.

## Important integration notes
The activation endpoint creates a unique payment intent and verifies the matching incoming TON Mainnet transaction from the same sender, to the receiving wallet, for at least 0.1 TON, with a unique `ARMCO MINING <payment-id>` comment. TON Connect's returned BOC is not treated as a transaction hash. Wallet addresses are normalized before comparison.

## Operational safety
- Run a full production build and verify one controlled Mainnet payment before relying on the fee in production.
- Provide a support/refund contact and clearly disclose that the fee is non-refundable once confirmed, if that is the intended policy.
- This is an access/anti-abuse fee, not an investment or a promise of token value or profit.
