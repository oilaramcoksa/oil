'use client';

// Telegram WebApp SDK hook — initializes the Telegram webapp if available,
// and exposes a stable interface. Falls back gracefully when not in Telegram
// (e.g. opening the preview in a regular browser).

import { useEffect, useState } from 'react';

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  close: () => void;
  initData: string;
  initDataUnsafe: {
    user?: TelegramUser;
    start_param?: string;
  };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  enableClosingConfirmation?: () => void;
  disableVerticalSwipes?: () => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function useTelegram() {
  const [tg, setTg] = useState<TelegramWebApp | null>(null);
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [startParam, setStartParam] = useState<string | null>(null);

  useEffect(() => {
    const webApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
    if (!webApp) return;
    try {
      webApp.ready();
      webApp.expand();
      try { webApp.setHeaderColor('#ffdcab'); } catch { /* noop */ }
      try { webApp.setBackgroundColor('#fff3d6'); } catch { /* noop */ }
      try { webApp.disableVerticalSwipes?.(); } catch { /* noop */ }
    } catch {
      /* noop */
    }
    // Defer state updates to avoid cascading renders.
    const u = webApp.initDataUnsafe?.user ?? null;
    const p = webApp.initDataUnsafe?.start_param ?? null;
    queueMicrotask(() => {
      setTg(webApp);
      setUser(u);
      setStartParam(p);
    });
  }, []);

  const haptic = (kind: 'light' | 'medium' | 'heavy' = 'light') => {
    try {
      tg?.HapticFeedback?.impactOccurred(kind);
    } catch { /* noop */ }
  };
  const notify = (type: 'success' | 'warning' | 'error') => {
    try {
      tg?.HapticFeedback?.notificationOccurred(type);
    } catch { /* noop */ }
  };

  return { tg, user, startParam, haptic, notify };
}
