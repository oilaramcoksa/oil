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

## Reward and wallet safety

TADS show/click callbacks are used for diagnostics only. They do not credit oil, coins, USD, or any transferable wallet balance. Client-side callbacks are not trusted proof of a billable event. Do not add wallet rewards based on these callbacks.

TADS terms state that publisher webhooks are technical event notifications, may be delivered best-effort, and are not confirmation of billability. Any future reward system must be separately designed with server-side validation, idempotency, and a clear budget funded by the publisher.

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
