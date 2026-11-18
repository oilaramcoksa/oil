import type { TonConnectUI } from '@tonconnect/ui';

let tonConnectInstance: TonConnectUI | null = null;
let tonConnectPromise: Promise<TonConnectUI> | null = null;

/** Return the app-wide TON Connect UI instance so wallet and withdrawal flows share one session. */
export function getTonConnectUI(): Promise<TonConnectUI> {
  if (tonConnectInstance) return Promise.resolve(tonConnectInstance);
  if (tonConnectPromise) return tonConnectPromise;
  tonConnectPromise = import('@tonconnect/ui').then(({ TonConnectUI }) => {
    if (!tonConnectInstance) {
      tonConnectInstance = new TonConnectUI({
        manifestUrl: new URL('/api/mining/activation/tonconnect-manifest.json', window.location.origin).toString(),
        restoreConnection: true,
      });
    }
    return tonConnectInstance;
  }).catch((error) => {
    tonConnectPromise = null;
    throw error;
  });
  return tonConnectPromise;
}
