'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

type Notice = { id: string; title: string; message: string; kind: string };

export function AdminNotices({ initData, isVerified }: { initData: string; isVerified: boolean }) {
  const seen = useRef<Set<string>>(new Set());

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
          if (seen.current.size > 200) {
            const first = seen.current.values().next().value;
            if (first) seen.current.delete(first);
          }
          if (notice.message) {
            toast(notice.title || 'إشعار من الإدارة', {
              description: notice.message,
              duration: 9000,
              className: 'aram-admin-notice',
            });
          }
        }
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
  }, [initData, isVerified]);

  return null;
}
