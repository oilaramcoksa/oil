# Telegram Mini App setup

This project already had a Telegram WebApp client hook. This change adds server-side validation of Telegram initData and a bot /start webhook.

## Vercel environment variables

- TELEGRAM_BOT_TOKEN: token from @BotFather. Keep server-side only.
- TELEGRAM_WEBHOOK_SECRET: random secret of at least 32 characters (letters, digits, underscore, hyphen).
- NEXT_PUBLIC_APP_URL: deployed HTTPS URL, e.g. https://oil-silk.vercel.app.

Never use a NEXT_PUBLIC_ prefix for the bot token and never commit secrets.

## Configure the bot

1. Create/select the bot using @BotFather.
2. Deploy this branch to the Vercel project.
3. Register the webhook (replace placeholders locally; do not commit real values):

```bash
curl -X POST 'https://api.telegram.org/bot<BOT_TOKEN>/setWebhook' \
  -d 'url=https://oil-silk.vercel.app/api/telegram/webhook' \
  -d 'secret_token=<TELEGRAM_WEBHOOK_SECRET>' \
  -d 'allowed_updates=["message"]'
```

4. In @BotFather, use /setmenubutton and set the Web App URL to https://oil-silk.vercel.app.
5. Test /start, menu launch, and mobile/Desktop Telegram clients.

## Security

The auth endpoint verifies Telegram's HMAC signature, checks auth_date freshness (24 hours), and returns the verified user and start parameter. initDataUnsafe is not trusted. Existing game-state and withdrawal APIs still require their own authorization and must be bound to this verified identity before real-value payouts are enabled.
