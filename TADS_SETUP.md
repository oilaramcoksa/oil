# TADS setup for Aramco Oil

## Active widgets

| Widget ID | Dashboard format | App placement |
|---|---|---|
| 13283 | FULLSCREEN | Optional "Watch an ad" action on the Pump screen |
| 13284 | TGB | Native text-graphic ad block in the Store screen |

Both IDs are configured as defaults in the app. They can be overridden through Vercel environment variables if needed:

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

The fullscreen widget (13283) is used for rewarded views. Its SDK completion callback asks the authenticated server endpoint `POST /api/ads/reward` to credit 100 game coins, plus any daily ad-mission milestone bonus. The endpoint applies a 20-claim daily cap, a 30-second cooldown, unique claim IDs, and records each credit in Turso wallet, ledger, player events, and daily/weekly/monthly stats. The Store's static TGB widget (13284) remains a native ad placement; its separate button launches the rewarded fullscreen widget.

Important verification limitation: the SDK callback is a client-side completion signal, not cryptographic proof that TADS billed or fully served an impression. TADS publisher webhooks are technical/best-effort notifications and are not confirmation of billability. The current reward flow therefore enforces authentication, rate limits, and idempotency, but cannot guarantee provider-verified completion. Do not describe these rewards as verified billable impressions. For stronger fraud resistance, obtain a provider-supported signed completion/verification mechanism before increasing reward limits or treating views as payable inventory.

## Operational checks

1. Open the game inside Telegram using the exact domain registered as the TADS Site.
2. Open the Pump tab and press "Watch an ad" to test widget 13283.
3. Open Store and confirm the TGB block from widget 13284 is visible.
4. If no ad is returned, check that both widgets are active, the registered Site matches the Mini App domain, and there is eligible inventory for the user.
5. Check widget views/clicks in the TADS Publisher dashboard; reporting may be delayed.

## References

- TADS Publisher integration guide: https://tads.me/publisher-doc
- Official React SDK: https://www.npmjs.com/package/react-tads-widget
- TADS terms and webhook notes: https://tads.me/terms
