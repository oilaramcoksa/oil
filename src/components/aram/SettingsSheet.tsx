'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '@/lib/store';
import { t, LANGS, type Lang } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { X, Globe, Volume2, Vibrate, Info, ChevronLeft, Droplet, Database } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useTelegram } from '@/hooks/use-telegram';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsSheet({ open, onClose }: Props) {
  const lang = useGame((s) => s.lang);
  const setLang = useGame((s) => s.setLang);
  const sound = useGame((s) => s.sound);
  const vibration = useGame((s) => s.vibration);
  const toggleSound = useGame((s) => s.toggleSound);
  const toggleVibration = useGame((s) => s.toggleVibration);
  const { haptic } = useTelegram();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 220 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md bg-gradient-to-b from-[#2a1c0a] to-[#0c0703] rounded-t-3xl sm:rounded-3xl overflow-hidden aram-safe-bottom max-h-[90vh] overflow-y-auto aram-scroll"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-[#2a1c0a]/95 backdrop-blur-md border-b border-amber-500/20 px-4 py-3 flex items-center justify-between">
              <button onClick={() => { haptic('light'); onClose(); }} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white">
                <X className="w-4 h-4" />
              </button>
              <h3 className="text-amber-100 font-black text-sm">{t(lang, 'settingsTitle')}</h3>
              <div className="w-8" />
            </div>

            <div className="p-4 space-y-3">
              {/* Brand */}
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg">
                  <Droplet className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="text-amber-100 font-black text-base">{t(lang, 'appName')}</div>
                  <div className="text-amber-200/60 text-[10px] font-bold">v1.0</div>
                </div>
              </div>

              {/* Language */}
              <div className="aram-card-dark rounded-2xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-100 font-bold text-xs uppercase">{t(lang, 'language')}</span>
                </div>
                <div className="space-y-1">
                  {LANGS.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => { haptic('light'); setLang(l.code as Lang); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm ${
                        lang === l.code
                          ? 'bg-amber-500/20 text-amber-200'
                          : 'text-amber-100/80 hover:bg-white/5'
                      }`}
                    >
                      <span className="text-xl">{l.flag}</span>
                      <span className="font-bold flex-1">{l.label}</span>
                      {lang === l.code && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <div className="aram-card-dark rounded-2xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-amber-400" />
                    <span className="text-amber-100 font-bold text-xs">{t(lang, 'sound')}</span>
                  </div>
                  <Switch checked={sound} onCheckedChange={toggleSound} />
                </div>
                <div className="h-px bg-amber-500/15" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Vibrate className="w-4 h-4 text-amber-400" />
                    <span className="text-amber-100 font-bold text-xs">{t(lang, 'vibration')}</span>
                  </div>
                  <Switch checked={vibration} onCheckedChange={toggleVibration} />
                </div>
              </div>

              {/* About */}
              <div className="aram-card-dark rounded-2xl p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Info className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-100 font-bold text-xs uppercase">{t(lang, 'about')}</span>
                </div>
                <p className="text-[11px] text-amber-200/70 font-bold leading-relaxed">
                  {t(lang, 'aboutText')}
                </p>
              </div>

              {/* Data storage */}
              <div className="aram-card-dark rounded-2xl p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Database className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-100 font-bold text-xs uppercase">{t(lang, 'dataStorage')}</span>
                </div>
                <p className="text-[11px] text-amber-200/70 font-bold leading-relaxed">
                  {t(lang, 'dataStorageText')}
                </p>
              </div>

              <Button
                onClick={() => { haptic('light'); onClose(); }}
                className="w-full h-11 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-[#2a1c0a] font-black text-sm"
              >
                {t(lang, 'back')}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
