'use client';

// Telegram Mini App bridge. Identity is accepted only after server-side initData validation.
import { useEffect, useState } from 'react';
interface TelegramUser { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string; photo_url?: string; }
interface TelegramWebApp {
  ready: () => void; expand: () => void; close: () => void; initData: string;
  colorScheme: 'light' | 'dark'; themeParams: Record<string, string>;
  setHeaderColor: (color: string) => void; setBackgroundColor: (color: string) => void;
  disableVerticalSwipes?: () => void;
  HapticFeedback?: { impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void; notificationOccurred: (type: 'error' | 'success' | 'warning') => void; selectionChanged: () => void; };
  openTelegramLink?: (url: string) => void; openLink?: (url: string) => void;
}
declare global { interface Window { Telegram?: { WebApp?: TelegramWebApp } } }
export function useTelegram() {
  const [tg, setTg] = useState<TelegramWebApp | null>(null);
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [startParam, setStartParam] = useState<string | null>(null);
  const [isTelegram, setIsTelegram] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;
    try { webApp.ready(); webApp.expand(); webApp.setHeaderColor('#ffdcab'); webApp.setBackgroundColor('#fff3d6'); webApp.disableVerticalSwipes?.(); } catch { /* client compatibility */ }
    setTg(webApp); setIsTelegram(true);
    if (!webApp.initData) return;
    fetch('/api/telegram/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: webApp.initData }), cache: 'no-store' })
      .then(async (res) => { if (!res.ok) throw new Error('Telegram auth failed'); return res.json(); })
      .then((data: { user: TelegramUser; startParam?: string | null }) => { if (cancelled) return; setUser(data.user); setStartParam(data.startParam ?? null); setIsVerified(true); })
      .catch(() => { if (!cancelled) { setUser(null); setIsVerified(false); } });
    return () => { cancelled = true; };
  }, []);
  const haptic = (kind: 'light' | 'medium' | 'heavy' = 'light') => { try { tg?.HapticFeedback?.impactOccurred(kind); } catch { /* noop */ } };
  const notify = (type: 'success' | 'warning' | 'error') => { try { tg?.HapticFeedback?.notificationOccurred(type); } catch { /* noop */ } };
  return { tg, user, startParam, haptic, notify, isTelegram, isVerified, initData: tg?.initData ?? '' };
}
