# TADS setup for Aramco Oil

## Current configured widget

- Fullscreen widget ID: 13283
- Format in TADS dashboard: FULLSCREEN
- Placement: optional user-triggered button on the Pump screen
- SDK: https://w.tads.me/widget.js
- Production mode: debug=false

## Required additional widget for all placements

Create a second widget in TADS Publisher > Widgets using the same registered Site:

- Name: aramcoil-tgb
- Type: TGB (STATIC) / Text-Graphic Block
- Suggested ads amount: 1–2
- Keep the app's domain exactly the same as the Site registered in TADS.

Then add this environment variable in Vercel:

```env
NEXT_PUBLIC_TADS_FULLSCREEN_WIDGET_ID=13283
NEXT_PUBLIC_TADS_TGB_WIDGET_ID=YOUR_NEW_TGB_WIDGET_ID
```

Set it for Production (and Preview only if you want ads in preview deployments), then redeploy.

The TGB placement appears in the Store screen only after the second widget ID is configured. The existing FULLSCREEN widget is not interchangeable with a TGB widget; do not put ID 13283 in the TGB variable.

## Rewarded-ad safety

TADS show/click callbacks are handled as client-side events for UI/diagnostics only. They do not credit oil, coins, USD, or any transferable wallet balance. A browser callback can be forged. Before adding a reward, configure a server-to-server TADS webhook and verify its documented authentication/signature and event payload, then make reward grants idempotent in the database. The webhook contract must be confirmed with TADS documentation/support before any wallet credit is enabled.

## Operational checks

1. Open the game inside Telegram using the exact registered domain.
2. Open the Pump tab and press "Watch an ad" to test the FULLSCREEN widget.
3. Open Store and confirm the TGB ad block appears.
4. If no ad is returned, check that the widget is active, the site domain matches, debug is false, and the network has eligible inventory for that user.
5. Check widget views/clicks in the TADS Publisher dashboard; reporting may be delayed.

Official docs:
- https://tads.me/publisher-doc
- https://tads.gitbook.io/docs/getting-started/publishers/embed-widget/vanilla-js
- https://tads.gitbook.io/docs/getting-started/publishers/faq-publishers/faq-en
