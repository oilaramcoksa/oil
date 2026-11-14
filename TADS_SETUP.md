# TADS setup for Aramco Oil

## Active widgets

| Widget ID | Dashboard format | App placement |
|---|---|---|
| 13283 | FULLSCREEN | Rewarded ad missions (30 views per 12-hour cycle) |
| 13284 | TGB | Native text-graphic ad block in the Store screen |

Both IDs are configured as defaults in the app. They can be overridden through Vercel environment variables:

```env
NEXT_PUBLIC_TADS_FULLSCREEN_WIDGET_ID=13283
NEXT_PUBLIC_TADS_TGB_WIDGET_ID=13284
```

## Official integration

The app uses the official `react-tads-widget` package and `TadsWidgetProvider`.

- Static TGB: `<TadsWidget id="13284" type="static" debug={false} />`
- Fullscreen: `renderTadsWidget({ id: "13283", type: "fullscreen" })`

The provider is initialized at the application root. Keep `debug={false}` in production.

## Rewarded ads and wallet safety

All rewarded ad missions use TADS fullscreen widget 13283. The completion callback asks the authenticated server endpoint `POST /api/ads/reward` to credit 100 game coins. The server enforces a 30-claim cap per 12-hour cycle, a 30-second cooldown, unique claim IDs, and records each credit in Turso wallet, immutable ledger, player events, and daily/weekly/monthly stats.

Important verification limitation: the SDK completion callback is a client-side completion signal, not cryptographic proof that TADS billed or fully served an impression. TADS publisher webhooks are technical/best-effort notifications and are not confirmation of billability. The reward flow enforces authentication, rate limits, and idempotency, but cannot guarantee provider-verified completion. Do not describe these rewards as verified billable impressions.

## Operational checks

1. Open the game inside Telegram using the exact domain registered as the TADS Site.
2. Open Tasks and complete a rewarded fullscreen ad using widget 13283.
3. Open Store and confirm the TGB block from widget 13284 is visible.
4. If no ad is returned, check that both widgets are active, the registered Site matches the Mini App domain, and eligible inventory is available.
5. Check widget views/clicks in the TADS Publisher dashboard; reporting may be delayed.

## References

- TADS Publisher integration guide: https://www.tads.me/publisher-doc
- Official React SDK: https://www.npmjs.com/package/react-tads-widget
- TADS terms and webhook notes: https://tads.me/terms
