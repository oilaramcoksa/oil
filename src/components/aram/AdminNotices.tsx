'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useGame } from '@/lib/store';
import { t } from '@/lib/i18n';

type Notice = { id: string; title: string; message: string; kind: string };

export function AdminNotices({ initData, isVerified }: { initData: string; isVerified: boolean }) {
  const lang = useGame((state) => state.lang);
  const seen = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  useEffect(() => {
    if (!isVerified || !initData) return;
    let disposed = false;
    let loading = false;
    const poll = async () => {
      if (disposed || loading) return;
      loading = true;
      try {
        const response = await fetch('/api/players/notifications', {
          headers: { 'X-Telegram-Init-Data': initData },
          cache: 'no-store',
        });
        if (!response.ok) return;
        const data = await response.json() as { notifications?: Notice[] };
        const notices = Array.isArray(data.notifications) ? data.notifications : [];
        for (const notice of notices.reverse()) {
          if (!notice.id || seen.current.has(notice.id)) continue;
          seen.current.add(notice.id);
          if (!initialized.current) continue;
          if (seen.current.size > 200) {
            const first = seen.current.values().next().value;
            if (first) seen.current.delete(first);
          }
          if (notice.message) {
            toast(notice.title || t(lang, 'adminNotice'), {
              description: notice.message,
              duration: 9000,
              className: 'aram-admin-notice',
            });
          }
        }
        initialized.current = true;
      } catch {
        // The next poll retries when the network becomes available.
      } finally {
        loading = false;
      }
    };
    void poll();
    const interval = window.setInterval(() => { void poll(); }, 10000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [initData, isVerified, lang]);

  return null;
}
