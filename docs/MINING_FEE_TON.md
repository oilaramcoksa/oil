# ARMCO OIL — One-time TON mining activation fee

## Behavior
- Default: every player must pay exactly 0.05 TON once before starting their first mining cycle.
- Admin may exempt an individual Telegram player ID; exempt players bypass the fee.
- A confirmed payment or admin exemption is permanent for that account.
- The fee notice is shown before the player reaches the pump.
- Jetton launch is intentionally not part of this change. The game token can be created and published later.

## Required deployment variables
- `TON_MINING_FEE_WALLET`: the receiving TON Mainnet wallet.
- `TONCENTER_API_KEY`: recommended TON Center API key for transaction lookup.
- `TONCENTER_API_URL`: optional, defaults to `https://toncenter.com/api/v2`.
- `NEXT_PUBLIC_APP_URL`: canonical public app origin used by the TON Connect manifest.

Do not put private keys, seed phrases, or API secrets in client-side variables.

## Important integration notes
The activation endpoint must validate the incoming transaction's destination, sender and value on-chain. The payment status endpoint also needs to decode the TON Connect BOC into the resulting on-chain transaction hash before it can mark a payment paid. Never treat a returned BOC as a transaction hash. See TON Connect's sendTransaction docs and TON Center getTransactions docs.

## Operational safety
- Verify payment on Mainnet with a small controlled transaction before enabling the fee globally.
- Provide a support/refund contact and clearly disclose that the fee is non-refundable once confirmed, if that is the intended policy.
- This is an access/anti-abuse fee, not an investment or a promise of token value or profit.
