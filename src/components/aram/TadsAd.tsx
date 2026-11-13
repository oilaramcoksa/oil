'use client';

import { useCallback } from 'react';
import { TadsWidget, renderTadsWidget } from 'react-tads-widget';
import { Megaphone, Play } from 'lucide-react';

type Props = {
  widgetId: number;
  mode: 'static' | 'fullscreen';
  title: string;
  description?: string;
  actionLabel?: string;
  className?: string;
};

export function TadsAd({ widgetId, mode, title, description, actionLabel, className = '' }: Props) {
  const id = String(widgetId);
  const handleShow = useCallback((result: unknown) => {
    // TADS callback is for ad reporting only; never grant coins or wallet funds here.
    console.info('TADS ad shown', result);
  }, []);
  const handleClick = useCallback((result: unknown) => {
    console.info('TADS ad clicked', result);
  }, []);
  const handleNotFound = useCallback(() => {
    console.info('TADS: no eligible ad for widget', id);
  }, [id]);

  const showFullscreen = useCallback(() => {
    try {
      renderTadsWidget({ id, type: 'fullscreen' });
    } catch (error) {
      console.warn('TADS fullscreen could not be opened', error);
    }
  }, [id]);

  if (mode === 'static') {
    return (
      <section className={`w-full overflow-hidden rounded-2xl border border-amber-300/60 bg-white/90 p-2 shadow-sm ${className}`} aria-label={title}>
        <div className="mb-1 flex items-center gap-1.5 text-[9px] font-black text-amber-900/60">
          <Megaphone className="h-3 w-3" /> {title}
        </div>
        <TadsWidget
          id={id}
          type="static"
          debug={false}
          onClickReward={handleClick}
          onAdsNotFound={handleNotFound}
        />
        {description && <p className="sr-only">{description}</p>}
      </section>
    );
  }

  return (
    <div className={className}>
      <TadsWidget
        id={id}
        type="fullscreen"
        debug={false}
        onShowReward={handleShow}
        onAdsNotFound={handleNotFound}
      />
      <button
        type="button"
        onClick={showFullscreen}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-r from-[#33213b] to-[#563126] px-4 py-2.5 text-xs font-black text-amber-50 shadow-md transition hover:brightness-110"
      >
        <Play className="h-4 w-4 fill-current" />
        {actionLabel ?? title}
      </button>
    </div>
  );
}
