'use client';

import { useEffect } from 'react';

type MonetagWindow = Window & {
  show_12295910?: (options: {
    type: 'inApp';
    inAppSettings: {
      frequency: number;
      capping: number;
      interval: number;
      timeout: number;
      everyPage: boolean;
    };
  }) => Promise<unknown>;
  Telegram?: { WebApp?: { initData?: string } };
  __armcoMonetagAppOpenShown?: boolean;
};

/**
 * One non-rewarded Monetag in-app ad on the first verified game entry per
 * page session. No recurring page/tab ads and no automatic reward claims.
 */
export function MonetagInAppAds({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const w = window as MonetagWindow;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (w.__armcoMonetagAppOpenShown) {
        window.clearInterval(timer);
        return;
      }
      if (!w.Telegram?.WebApp?.initData || typeof w.show_12295910 !== 'function') {
        if (attempts >= 80) window.clearInterval(timer);
        return;
      }
      w.__armcoMonetagAppOpenShown = true;
      window.clearInterval(timer);
      void w.show_12295910({
        type: 'inApp',
        inAppSettings: {
          frequency: 1,
          capping: 1,
          interval: 0,
          timeout: 5,
          everyPage: false,
        },
      }).catch((error) => {
        console.warn('Monetag app-open ad unavailable', error);
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [enabled]);

  return null;
}
