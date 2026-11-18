'use client';

import { useEffect } from 'react';

type MonetagWindow = Window & {
  show_12295910?: (options: {
    type: 'inApp';
    ymid?: string;
    requestVar?: string;
    inAppSettings: {
      frequency: number;
      capping: number;
      interval: number;
      timeout: number;
      everyPage: boolean;
    };
  }) => Promise<unknown>;
  Telegram?: { WebApp?: { initData?: string } };
  __armcoMonetagInAppStarted?: boolean;
};

export function MonetagInAppAds() {
  useEffect(() => {
    const w = window as MonetagWindow;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (w.__armcoMonetagInAppStarted) {
        window.clearInterval(timer);
        return;
      }
      // Monetag's TMA SDK needs the app to be opened as a real Telegram Mini App.
      if (!w.Telegram?.WebApp?.initData || typeof w.show_12295910 !== 'function') {
        if (attempts >= 80) window.clearInterval(timer);
        return;
      }
      w.__armcoMonetagInAppStarted = true;
      window.clearInterval(timer);
      void w.show_12295910({
        type: 'inApp',
        ymid: crypto.randomUUID(),
        requestVar: 'automatic_in_app',
        inAppSettings: {
          frequency: 2,
          capping: 0.1,
          interval: 30,
          timeout: 5,
          everyPage: false,
        },
      }).catch((error) => {
        console.warn('Monetag in-app interstitial setup failed', error);
        w.__armcoMonetagInAppStarted = false;
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
