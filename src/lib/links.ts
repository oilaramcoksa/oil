/**
 * Single source of truth for every public link of the app.
 * Override per environment with the NEXT_PUBLIC_* variables; the defaults are production.
 */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://oil-silk.vercel.app';
export const BOT_URL = process.env.NEXT_PUBLIC_TWA_RETURN_URL || 'https://t.me/armcooilbot';
/** Direct entry link into the bot (guest start parameter). */
export const GUEST_ENTRY_URL = process.env.NEXT_PUBLIC_GUEST_ENTRY_URL || 'https://t.me/armcooilbot?start=guest_gsasw02p';
