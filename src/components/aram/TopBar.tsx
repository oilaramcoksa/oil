'use client';

import { Trophy, Settings, Coins, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { useGame, effectiveSpeed } from '@/lib/store';
import { t } from '@/lib/i18n';
import { useTelegram } from '@/hooks/use-telegram';
import { LANGS } from '@/lib/i18n';
import { useState, useEffect, useRef } from 'react';

const LANG_DISPLAY_CODES: Record<string, string> = { ar: 'EG', en: 'GB', ru: 'RU', es: 'ES', pt: 'BR', fr: 'FR', de: 'DE', tr: 'TR', zh: 'CN', hi: 'IN', id: 'ID', bn: 'BD', ja: 'JP', ko: 'KR', ur: 'PK' };

interface Props {
  onOpenSettings: () => void;
  onOpenTournaments: () => void;
}

export function TopBar({ onOpenSettings, onOpenTournaments }: Props) {
  const lang = useGame((s) => s.lang);
  const setLang = useGame((s) => s.setLang);
  const coins = useGame((s) => s.coins);
  const upgrades = useGame((s) => s.upgrades);
  const speed = effectiveSpeed(upgrades);
  const { haptic } = useTelegram();
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  // Close language dropdown when clicking outside
  useEffect(() => {
    if (!langOpen) return;
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [langOpen]);

  return (
    <header className="aram-safe-top relative z-20 shrink-0 bg-gradient-to-b from-[#2a1c0a]/95 to-[#2a1c0a]/70 backdrop-blur-md border-b border-amber-500/20">
      <div className="max-w-md mx-auto px-3 py-2 flex items-center justify-between gap-2">
        {/* Left: language */}
        <div className="relative" ref={langRef}>
          <button
            onClick={() => { haptic('light'); setLangOpen((v) => !v); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-amber-500/15 hover:bg-amber-500/25 text-amber-100 text-xs font-bold border border-amber-500/30"
          >
            <span className="uppercase tracking-wide">{lang.toUpperCase()}</span>
            <span className="text-amber-200/80">{LANG_DISPLAY_CODES[lang] ?? lang.toUpperCase()}</span>
          </button>
          {langOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`absolute top-full mt-2 ${lang === 'ar' ? 'right-0' : 'left-0'} w-60 max-w-[calc(100vw-2rem)] max-h-[min(68dvh,640px)] overflow-y-auto overscroll-contain rounded-2xl border border-amber-500/35 bg-[#2a1c0a] shadow-[0_18px_45px_rgba(0,0,0,.55)] z-[70] aram-scroll`}
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => {
                    setLang(l.code);
                    setLangOpen(false);
                    haptic('light');
                  }}
                  className={`w-full px-4 py-2.5 text-sm flex items-center gap-2.5 whitespace-nowrap transition-colors ${
                    lang === l.code
                      ? 'bg-amber-500/20 text-amber-300 font-black'
                      : 'text-amber-100 hover:bg-white/10 font-bold'
                  }`}
                >
                  {lang === l.code && <span className="absolute left-4 w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,.8)]" />}
                  <span className="flex-1 text-right">{l.label}</span>
                  <span className="w-7 text-right font-black tracking-wide">{LANG_DISPLAY_CODES[l.code] ?? l.code.toUpperCase()}</span>
                </button>
              ))}
            </motion.div>
          )}
        </div>

        {/* Center: balance */}
        <div className="flex-1 flex justify-center">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/40 border border-amber-500/30">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-amber-100 font-black text-sm tabular-nums">
              {coins.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Right: speed + trophy + settings */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-purple-500/15 border border-purple-500/30">
            <Zap className="w-3.5 h-3.5 text-purple-300" />
            <span className="text-purple-200 font-bold text-xs tabular-nums">
              {speed >= 1000 ? `${(speed / 1000).toFixed(1)}k` : speed}
            </span>
          </div>
          <button
            onClick={() => { haptic('light'); onOpenTournaments(); }}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-amber-200"
            aria-label={t(lang, 'tournaments')}
          >
            <Trophy className="w-4 h-4" />
          </button>
          <button
            onClick={() => { haptic('light'); onOpenSettings(); }}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-amber-200"
            aria-label={t(lang, 'settings')}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
