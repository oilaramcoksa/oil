'use client';

declare global {
  interface Window {
    Adsgram?: {
      init: (options: { blockId: string }) => {
        show: () => Promise<{ done: boolean; description?: string; state?: string; error?: boolean }>;
      };
    };
  }
}

let sdkPromise: Promise<boolean> | null = null;
let activeAd: Promise<boolean> | null = null;

function loadAdsgram(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Adsgram) return Promise.resolve(true);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<boolean>((resolve) => {
    const script = document.querySelector<HTMLScriptElement>('script[data-adsgram-sdk="true"]') ?? document.createElement('script');
    const finish = () => resolve(Boolean(window.Adsgram));
    if (!script.isConnected) {
      script.src = 'https://sad.adsgram.ai/js/sad.min.js';
      script.async = true;
      script.dataset.adsgramSdk = 'true';
      document.head.appendChild(script);
    }
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => resolve(false), { once: true });
    window.setTimeout(finish, 5000);
  }).then((ready) => { if (!ready) sdkPromise = null; return ready; });
  return sdkPromise;
}

/** Non-rewarded action gate. It never calls the reward-credit API. */
export async function showActionInterstitial(): Promise<void> {
  if (activeAd) { await activeAd; return; }
  activeAd = (async () => {
    try {
      if (!await loadAdsgram() || !window.Adsgram) return;
      await window.Adsgram.init({ blockId: 'int-59643' }).show();
    } catch (error) {
      // Fail open: a network/no-fill issue must not block gameplay or money actions.
      console.info('Action interstitial unavailable; continuing', error);
    }
  })();
  try { await activeAd; } finally { activeAd = null; }
}
