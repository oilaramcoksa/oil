import type { TonConnectUI } from '@tonconnect/ui';
import { BOT_URL as BOT_LINK } from './links';

let tonConnectInstance: TonConnectUI | null = null;
let tonConnectPromise: Promise<TonConnectUI> | null = null;

const BOT_URL = BOT_LINK as `${string}://${string}`;

/**
 * App-wide TON Connect UI instance. Every screen (arena, store, wallet, fee gate)
 * MUST use this one: several instances fight over the same stored session and
 * modal, which makes the wallet flow drop the user out of the Mini App.
 * twaReturnUrl brings the user back into Telegram after approving in the wallet.
 */
export function getTonConnectUI(): Promise<TonConnectUI> {
  if (tonConnectInstance) return Promise.resolve(tonConnectInstance);
  if (tonConnectPromise) return tonConnectPromise;
  tonConnectPromise = import('@tonconnect/ui').then(({ TonConnectUI }) => {
    const instance = tonConnectInstance ?? new TonConnectUI({
      manifestUrl: new URL('/api/mining/activation/tonconnect-manifest.json', window.location.origin).toString(),
      restoreConnection: true,
      actionsConfiguration: { twaReturnUrl: BOT_URL, returnStrategy: 'back', skipRedirectToWallet: 'ios' },
    });
    tonConnectInstance = instance;
    return instance;
  }).catch((error) => {
    tonConnectPromise = null;
    throw error;
  });
  return tonConnectPromise;
}

/** Map any wallet/payment error to a stable code the UI can translate. */
export function classifyWalletError(error: unknown): 'rejected' | 'timeout' | 'not_connected' | 'unknown' {
  const text = String((error as { message?: string; name?: string })?.message ?? '') + ' ' + String((error as { name?: string })?.name ?? '');
  if (/reject|declin|cancel|UserRejects/i.test(text)) return 'rejected';
  if (/timeout|expired|validUntil/i.test(text)) return 'timeout';
  if (/not.?connected|WalletNotConnected/i.test(text)) return 'not_connected';
  return 'unknown';
}
