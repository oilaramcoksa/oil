# Monetag Telegram Mini App integration

Main SDK zone: `12295910`

The app loads the Monetag SDK once in `src/app/layout.tsx`. The app uses Monetag as its only advertising provider:

1. Rewarded Interstitial for task rewards and gameplay actions.
2. In-App Interstitial for automatic placements inside the Mini App.

## Server-side postback setup

Set a long random value as the Vercel environment variable:

`MONETAG_POSTBACK_SECRET`

In Monetag SSP, open the main SDK zone settings and configure this Postback URL, replacing YOUR_APP_DOMAIN and YOUR_SECRET with the production app domain and the exact same secret value:

`https://YOUR_APP_DOMAIN/api/ads/monetag/postback?secret=YOUR_SECRET&ymid={ymid}&zone_id={zone_id}&sub_zone_id={sub_zone_id}&event_type={event_type}&reward_event_type={reward_event_type}&request_var={request_var}&telegram_id={telegram_id}&estimated_price={estimated_price}`

Use HTTPS and do not add a redirect. One postback URL on the main zone covers the Monetag formats used by the app. Monetag distinguishes the delivered format using `sub_zone_id` and `request_var`.

## Reward security

- Each rewarded view sends a unique UUID as `ymid`.
- The frontend Promise is used for UI feedback only.
- Wallet credit is granted only after the server receives a matching Monetag postback for the authenticated Telegram player, main zone `12295910`, `event_type=impression`, and `reward_event_type=valued`.
- Each `ymid` can be consumed only once. Monetag postback retries do not grant duplicate rewards.
- Every valued Monetag view grants exactly 20 coins, including task, sale, mining-start, lucky-wheel, and in-app placements.
- Sale and mining-start actions continue if Monetag has no ad inventory, but no reward is granted without a verified valued postback.
- In-App Interstitial is configured with frequency 2, capping 0.1 hours, interval 30 seconds, timeout 5 seconds, and `everyPage=false`.

## Deployment checklist

1. Add `MONETAG_POSTBACK_SECRET` in Vercel Production Environment Variables.
2. Redeploy the app so the server endpoint can authenticate Monetag.
3. Paste the Postback URL above into the main Monetag SDK zone settings.
4. Test all formats inside the real Telegram Mini App.
5. Confirm valued postbacks reach `/api/ads/monetag/postback` and that each rewarded `ymid` credits only once.

The Monetag SDK Promise and server postback are delivered independently; the app waits for server verification before crediting the wallet.
