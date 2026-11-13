'use client';

import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Play, Loader2 } from 'lucide-react';

type TadsType = 'static' | 'fullscreen';
type TadsController = {
  loadAd?: () => Promise<unknown>;
  showAd?: () => Promise<unknown>;
};
type TadsInitOptions = {
  widgetId: number;
  type: TadsType;
  debug: boolean;
  onShowReward?: (result: unknown) => void;
  onClickReward?: (result: unknown) => void;
  onAdsNotFound?: () => void;
};
declare global {
  interface Window {
    tads?: {
      init: (options: TadsInitOptions) => TadsController | Promise<TadsController>;
      controllers?: Record<string, TadsController>;
    };
  }
}

let tadsScriptPromise: Promise<void> | null = null;
function loadTadsScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('browser_required'));
  if (window.tads?.init) return Promise.resolve();
  if (!tadsScriptPromise) {
    tadsScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-tads-sdk="true"]');
      const script = existing ?? document.createElement('script');
      const timeout = window.setTimeout(() => reject(new Error('tads_sdk_timeout')), 12000);
      const finish = () => { window.clearTimeout(timeout); resolve(); };
      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', () => {
        window.clearTimeout(timeout);
        tadsScriptPromise = null;
        reject(new Error('tads_sdk_load_failed'));
      }, { once: true });
      if (!existing) {
        script.src = 'https://w.tads.me/widget.js';
        script.async = true;
        script.dataset.tadsSdk = 'true';
        document.head.appendChild(script);
      }
      if (window.tads?.init) finish();
    });
  }
  return tadsScriptPromise;
}

async function getController(widgetId: number, type: TadsType, onShowReward?: (result: unknown) => void) {
  await loadTadsScript();
  if (!window.tads?.init) throw new Error('tads_sdk_unavailable');
  const existing = window.tads.controllers?.[String(widgetId)];
  if (existing) return existing;
  return await Promise.resolve(window.tads.init({
    widgetId,
    type,
    debug: false,
    onShowReward,
    onAdsNotFound: () => undefined,
  }));
}

type Props = {
  widgetId: number;
  mode: TadsType;
  title: string;
  description?: string;
  actionLabel?: string;
  className?: string;
};

export function TadsAd({ widgetId, mode, title, description, actionLabel, className = '' }: Props) {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const showFullscreen = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setUnavailable(false);
    try {
      const controller = await getController(widgetId, 'fullscreen');
      if (controller.loadAd) await controller.loadAd();
      if (!controller.showAd) throw new Error('tads_show_unavailable');
      await controller.showAd();
    } catch (error) {
      console.warn('TADS fullscreen ad unavailable:', error);
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [loading, widgetId]);

  useEffect(() => {
    if (mode !== 'static') return;
    let cancelled = false;
    void (async () => {
      try {
        const controller = await getController(widgetId, 'static');
        if (controller.loadAd) await controller.loadAd();
        if (!cancelled && controller.showAd) {
          await controller.showAd();
          setReady(true);
        }
      } catch (error) {
        console.warn('TADS native ad unavailable:', error);
        if (!cancelled) setUnavailable(true);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, widgetId]);

  if (mode === 'static') {
    return (
      <section className={`w-full overflow-hidden rounded-2xl border border-amber-300/60 bg-white/80 p-2 shadow-sm ${className}`} aria-label={title}>
        <div className="mb-1 flex items-center gap-1.5 text-[9px] font-black text-amber-900/55">
          <Megaphone className="h-3 w-3" /> {title}
        </div>
        <div id={`tads-container-${widgetId}`} className="min-h-0 w-full" />
        {unavailable && <p className="px-2 py-1 text-center text-[10px] font-bold text-amber-900/50">{description}</p>}
        {!ready && !unavailable && <div className="h-1 w-full animate-pulse rounded bg-amber-200/60" />}
      </section>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => void showFullscreen()}
        disabled={loading}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-r from-[#33213b] to-[#563126] px-4 py-2.5 text-xs font-black text-amber-50 shadow-md transition hover:brightness-110 disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
        {actionLabel ?? title}
      </button>
      {unavailable && <p className="mt-1 text-center text-[9px] font-bold text-amber-900/55">{description}</p>}
    </div>
  );
}
