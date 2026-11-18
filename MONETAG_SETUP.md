# Monetag Telegram Mini App integration

## SDK
- Main zone ID: `12295910`
- Format: Rewarded Interstitial
- SDK tag is loaded once from the application root:
  `https://libtl.com/sdk.js` with `data-zone="12295910"` and `data-sdk="show_12295910"`.
- The rewarded ad is called with a unique UUID `ymid` and `requestVar: rewarded_coins`.

## Server-side postback setup

Set a long random value as the Vercel environment variable:

`MONETAG_POSTBACK_SECRET`

In Monetag SSP, open the main SDK zone settings and configure this Postback URL, replacing YOUR_APP_DOMAIN and YOUR_SECRET with the production app domain and the exact same secret value:

`https://YOUR_APP_DOMAIN/api/ads/monetag/postback?secret=YOUR_SECRET&ymid={ymid}&zone_id={zone_id}&event_type={event_type}&reward_event_type={reward_event_type}&telegram_id={telegram_id}`

Use HTTPS and do not add a redirect. The endpoint accepts impression postbacks for zone 12295910 and stores them idempotently by ymid. The reward API credits 100 coins only when:
- the authenticated Telegram player submits the matching ymid;
- a matching Monetag server postback exists for that Telegram ID and main zone;
- event_type is impression and reward_event_type is valued;
- the ymid has not already been consumed.

Non-valued events are stored for diagnostics but cannot grant coins. Postback retries cannot grant a second reward.

## Runtime behavior

Monetag is the third provider/fallback in the rewarded-ad flow. Existing Adexium and TADS flows remain available. Monetag is currently enabled for coin rewards, not the lucky-wheel reward purpose.

## Deployment checklist

1. Add `MONETAG_POSTBACK_SECRET` in Vercel Production Environment Variables.
2. Redeploy the app so the server endpoint can authenticate Monetag.
3. Paste the Postback URL into the main Monetag SDK zone settings.
4. Test inside Telegram Mini App with a real available ad.
5. Confirm the postback reaches `/api/ads/monetag/postback` and only a valued impression credits coins.

The frontend SDK Promise is used for UI feedback, while the wallet credit is independently gated by the Monetag server-side postback.
