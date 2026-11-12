'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useGame } from '@/lib/store';
import { t, LANGS, type Lang } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { ChevronRight, Droplet, ShieldCheck } from 'lucide-react';
import { useTelegram } from '@/hooks/use-telegram';

export function Onboarding() {
  const lang = useGame((s) => s.lang);
  const setLang = useGame((s) => s.setLang);
  const complete = useGame((s) => s.completeOnboarding);
  const accept = useGame((s) => s.acceptDisclaimer);
  const accepted = useGame((s) => s.acceptedDisclaimer);
  const { haptic } = useTelegram();
  const [step, setStep] = useState<0 | 1>(0);

  return (
    <div className="aram-bg min-h-screen flex flex-col">
      {/* Logo / brand */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 14 }}
          className="mb-4"
        >
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[#2a1c0a] to-[#0c0703] flex items-center justify-center shadow-2xl border-2 border-amber-400/40">
            <Droplet className="w-12 h-12 text-amber-400" />
          </div>
        </motion.div>

        <motion.h1
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="text-3xl font-black text-[#2a1c0a] tracking-tight"
        >
          {t(lang, 'appName')}
        </motion.h1>
        <motion.p
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="text-sm font-bold text-amber-900/70 mt-1"
        >
          {t(lang, 'appTagline')}
        </motion.p>

        {step === 0 && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-8 w-full max-w-xs"
          >
            <div className="text-xs font-black text-amber-900/60 uppercase mb-2">{t(lang, 'chooseLang')}</div>
            <div className="space-y-2">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => { haptic('light'); setLang(l.code as Lang); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-colors ${
                    lang === l.code
                      ? 'bg-amber-500/20 border-amber-500 text-[#2a1c0a]'
                      : 'bg-white/60 border-white/60 text-[#2a1c0a] hover:bg-white/80'
                  }`}
                >
                  <span className="text-2xl">{l.flag}</span>
                  <span className="font-black flex-1 text-left">{l.label}</span>
                  {lang === l.code && <ShieldCheck className="w-4 h-4 text-amber-600" />}
                </button>
              ))}
            </div>

            <Button
              onClick={() => { haptic('medium'); setStep(1); }}
              className="mt-4 w-full h-12 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-[#2a1c0a] font-black text-base shadow-lg"
            >
              {t(lang, 'startBtn')}
              <ChevronRight className="w-4 h-4 ml-1" style={{ transform: lang === 'ar' ? 'scaleX(-1)' : 'none' }} />
            </Button>
          </motion.div>
        )}

        {step === 1 && !accepted && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mt-6 w-full max-w-sm aram-card rounded-3xl p-5"
          >
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-5 h-5 text-amber-600" />
              <h3 className="font-black text-[#2a1c0a]">{t(lang, 'disclaimerTitle')}</h3>
            </div>
            <p className="text-xs text-amber-900/80 font-bold leading-relaxed">
              {t(lang, 'disclaimerBody')}
            </p>
            <Button
              onClick={() => { haptic('heavy'); accept(); }}
              className="mt-4 w-full h-11 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-black text-sm"
            >
              {t(lang, 'iUnderstand')}
            </Button>
          </motion.div>
        )}

        {step === 1 && accepted && (
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="mt-6"
          >
            <Button
              onClick={() => { haptic('heavy'); complete(); }}
              className="w-64 h-14 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-[#2a1c0a] font-black text-lg shadow-xl"
            >
              {t(lang, 'welcome')} {t(lang, 'appName')}
              <ChevronRight className="w-5 h-5 ml-1" style={{ transform: lang === 'ar' ? 'scaleX(-1)' : 'none' }} />
            </Button>
          </motion.div>
        )}
      </div>

      <div className="text-[10px] text-amber-900/40 font-bold text-center pb-4">
        v1.0 · aramcooil
      </div>
    </div>
  );
}
