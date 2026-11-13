'use client';

import { createElement, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

type Props = {
  initData: string;
  isVerified: boolean;
  onReward?: () => void;
  onError?: (error: string) => void;
};

const BLOCK_ID = 'task-59644';
const SDK_URL = 'https://sad.adsgram.ai/js/sad.min.js';

export function AdsgramTaskAd({ initData, isVerified, onReward, onError }: Props) {
  const taskRef = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const markReady = () => {
      if (!cancelled) setReady(Boolean(customElements.get('adsgram-task')));
    };
    if (customElements.get('adsgram-task')) {
      markReady();
      return () => { cancelled = true; };
    }
    let script = document.querySelector<HTMLScriptElement>('script[data-adsgram-sdk="true"]');
    if (!script) {
      script = document.createElement('script');
      script.src = SDK_URL;
      script.async = true;
      script.dataset.adsgramSdk = 'true';
      document.head.appendChild(script);
    }
    script.addEventListener('load', markReady);
    script.addEventListener('error', () => onError?.('adsgram_task_sdk_unavailable'), { once: true });
    void customElements.whenDefined('adsgram-task').then(markReady).catch(() => {
      if (!cancelled) onError?.('adsgram_task_sdk_unavailable');
    });
    return () => {
      cancelled = true;
      script?.removeEventListener('load', markReady);
    };
  }, [onError]);

  useEffect(() => {
    const element = taskRef.current;
    if (!element) return;
    const handleReward = () => onReward?.();
    const handleError = (event: Event) => onError?.((event as CustomEvent<string>).detail || 'adsgram_task_error');
    element.addEventListener('reward', handleReward);
    element.addEventListener('onError', handleError);
    element.addEventListener('onBannerNotFound', handleError);
    element.addEventListener('onTooLongSession', handleError);
    return () => {
      element.removeEventListener('reward', handleReward);
      element.removeEventListener('onError', handleError);
      element.removeEventListener('onBannerNotFound', handleError);
      element.removeEventListener('onTooLongSession', handleError);
    };
  }, [ready, onReward, onError]);

  if (!isVerified || !initData) {
    return createElement('p', { className: 'mt-2 text-center text-xs font-bold text-amber-900/60' }, 'يرجى فتح التطبيق من Telegram لتفعيل مشاهدة الإعلانات.');
  }

  if (!ready) {
    return createElement('div', { className: 'mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800' },
      createElement(Loader2, { className: 'h-4 w-4 animate-spin' }),
      'جاري تجهيز مشاهدة الإعلانات...'
    );
  }

  return createElement('div', { className: 'mt-2 w-full overflow-hidden rounded-xl' },
    createElement('adsgram-task', {
      ref: taskRef,
      'data-block-id': BLOCK_ID,
      'data-debug': 'false',
      'data-debug-console': 'false',
      className: 'adsgram-task-widget',
    },
      createElement('span', { slot: 'reward', className: 'adsgram-task-reward' }, 'مكافأة إكمال المهمة'),
      createElement('span', { slot: 'button', className: 'adsgram-task-button' }, 'مشاهدة الإعلانات'),
      createElement('span', { slot: 'claim', className: 'adsgram-task-button' }, 'استلام المكافأة'),
      createElement('span', { slot: 'done', className: 'adsgram-task-button' }, 'تمت المهمة')
    ),
    createElement('style', { jsx: true }, `
      .adsgram-task-widget {
        display: block;
        width: 100%;
        --adsgram-task-font-size: 14px;
        --adsgram-task-icon-size: 38px;
        --adsgram-task-icon-title-gap: 10px;
        --adsgram-task-icon-border-radius: 10px;
        --adsgram-task-button-width: 120px;
      }
      .adsgram-task-reward { color: #166534; font-weight: 900; }
      .adsgram-task-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 36px;
        border-radius: 10px;
        padding: 7px 12px;
        background: linear-gradient(90deg, #059669, #16a34a);
        color: white;
        font-size: 12px;
        font-weight: 900;
      }
    `)
  );
}
