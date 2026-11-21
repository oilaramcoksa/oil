'use client';

// React wrapper around the Three.js pump scene (src/lib/pumpScene3D.ts).
// The whole sell sequence now plays INSIDE the 3D scene (truck drives in,
// hose connects, oil visibly flows, work-lights dim during transfer then
// ramp back up, truck departs). The host subscribes via onSellEvent to drive
// its in-scene HUD (phase text, litres collected, coins earned) — no popup.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPumpScene, type PumpSceneHandles, type PumpSceneParts, type PumpSceneSpecial, type SellProgress } from '@/lib/pumpScene3D';
import { Droplet, Coins, Truck, Loader2, Check, Gauge } from 'lucide-react';
import { t } from '@/lib/i18n';

type Lang = Parameters<typeof t>[0];

export interface PumpScene3DProps {
  pumping: boolean;
  oilRatio: number;
  onTap: () => void;
  parts?: PumpSceneParts;
  specialParts?: PumpSceneSpecial;
  lang: Lang;
  /** Optional: called for each truck/sale animation phase. */
  onSellPhase?: (phase: SellProgress['phase']) => void;
  /** Optional: called when the sell sequence transitions to its "done" phase. */
  onSellDone?: () => void;
}

export interface PumpScene3DHandle {
  triggerSell: () => void;
  setSaleResult: (oilSold: number, coinsEarned: number) => void;
  resetSell: () => void;
}

const PHASE_LABEL_KEY: Record<SellProgress['phase'], string> = {
  idle: 'truckArriving',
  arriving: 'truckArriving',
  lights_on: 'sellLightsOn',
  connecting: 'truckConnecting',
  transferring: 'sellTransferring',
  lights_restore: 'sellLightsRestore',
  retracting: 'retractingHose',
  departing: 'sellDeparting',
  done: 'sellDone',
};

const PHASE_ICON: Record<SellProgress['phase'], 'truck' | 'lights' | 'connect' | 'flow' | 'retract' | 'depart' | 'done'> = {
  idle: 'truck',
  arriving: 'truck',
  lights_on: 'lights',
  connecting: 'connect',
  transferring: 'flow',
  lights_restore: 'lights',
  retracting: 'retract',
  departing: 'depart',
  done: 'done',
};

export const PumpScene3D = forwardRef<PumpScene3DHandle, PumpScene3DProps>(function PumpScene3D(
  { pumping, oilRatio, onTap, parts, specialParts, lang, onSellDone, onSellPhase },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const onSellDoneRef = useRef(onSellDone);
  onSellDoneRef.current = onSellDone;
  const onSellPhaseRef = useRef(onSellPhase);
  onSellPhaseRef.current = onSellPhase;
  const engineRef = useRef<PumpSceneHandles | null>(null);
  const [sell, setSell] = useState<SellProgress | null>(null);
  const doneNotifiedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = createPumpScene(canvas, () => onTapRef.current());
    engineRef.current = engine;
    const unsub = engine.onSellEvent((p) => {
      setSell(p);
      onSellPhaseRef.current?.(p.phase);
      if (p.phase === 'done' && !doneNotifiedRef.current) {
        doneNotifiedRef.current = true;
        onSellDoneRef.current?.();
      }
    });
    return () => { unsub(); engine.dispose(); engineRef.current = null; };
  }, []);

  // Forward prop changes to the engine without recreating it.
  useEffect(() => { engineRef.current?.setPumping(pumping); }, [pumping]);
  useEffect(() => { engineRef.current?.setOilRatio(oilRatio); }, [oilRatio]);
  useEffect(() => { engineRef.current?.setParts(parts ?? {}); }, [parts]);
  useEffect(() => { engineRef.current?.setSpecialParts(specialParts ?? {}); }, [specialParts]);

  useImperativeHandle(ref, () => ({
    triggerSell: () => { doneNotifiedRef.current = false; engineRef.current?.triggerSell(); },
    setSaleResult: (oilSold, coinsEarned) => engineRef.current?.setSaleResult(oilSold, coinsEarned),
    resetSell: () => { doneNotifiedRef.current = false; engineRef.current?.resetSell(); setSell(null); },
  }), []);

  const selling = !!sell && sell.phase !== 'idle';
  const phaseKey = sell ? PHASE_LABEL_KEY[sell.phase] : 'truckArriving';
  const phaseIcon = sell ? PHASE_ICON[sell.phase] : 'truck';

  return (
    <div className="relative h-full w-full select-none touch-none">
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_80px_rgba(0,0,0,.45)]" />

      {/* === In-scene sell HUD overlay === */}
      <AnimatePresence>
        {selling && (
          <motion.div
            key="sell-hud"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
            className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center px-3"
          >
            <div className="pointer-events-auto flex max-w-[92%] items-center gap-2 rounded-full border border-amber-200/40 bg-black/65 px-3 py-1.5 backdrop-blur-md">
              <span className={`grid h-6 w-6 place-items-center rounded-full ${phaseIcon === 'flow' ? 'bg-amber-500/30' : 'bg-white/10'}`}>
                {phaseIcon === 'truck' && <Truck className="h-3.5 w-3.5 text-amber-200" />}
                {phaseIcon === 'lights' && <span className="text-xs">💡</span>}
                {phaseIcon === 'connect' && <span className="text-xs">🔗</span>}
                {phaseIcon === 'flow' && <Droplet className="h-3.5 w-3.5 animate-bounce text-amber-300" />}
                {phaseIcon === 'retract' && <span className="text-xs">🔧</span>}
                {phaseIcon === 'depart' && <Truck className="h-3.5 w-3.5 text-emerald-300" />}
                {phaseIcon === 'done' && <Check className="h-3.5 w-3.5 text-emerald-300" />}
              </span>
              <span className="text-[12px] font-black text-white">
                {t(lang, phaseKey)}
              </span>
              {sell && sell.phase === 'arriving' && <Loader2 className="h-3 w-3 animate-spin text-amber-200/70" />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live oil-collected + coins-earned readouts (appear from the start of transfer) */}
      <AnimatePresence>
        {selling && sell && (sell.phase === 'transferring' || sell.phase === 'lights_restore' || sell.phase === 'retracting' || sell.phase === 'departing' || sell.phase === 'done') && (
          <motion.div
            key="sell-counter"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-none absolute left-1/2 top-[18%] z-30 -translate-x-1/2"
          >
            <div className="flex flex-col items-center gap-1">
              <div className="rounded-2xl border border-amber-300/40 bg-black/65 px-4 py-2 backdrop-blur-md">
                <div className="text-center text-[10px] font-bold uppercase tracking-wider text-amber-200/80">
                  {t(lang, 'collected')}
                </div>
                <div className="flex items-center justify-center gap-1.5 text-center text-2xl font-black tabular-nums text-amber-300 drop-shadow-[0_2px_6px_rgba(0,0,0,.9)]">
                  <Droplet className="h-4 w-4" />
                  <motion.span
                    key={sell.oilCollected}
                    initial={{ scale: 1.15, color: '#fde68a' }}
                    animate={{ scale: 1, color: '#fcd34d' }}
                    transition={{ duration: 0.18 }}
                  >
                    {sell.oilCollected.toLocaleString()}
                  </motion.span>
                  <span className="text-[10px] font-bold text-amber-200/70">{t(lang, 'oil')}</span>
                </div>
              </div>
              {sell.coinsEarned > 0 && (
                <motion.div
                  initial={{ y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: 'spring', damping: 14, stiffness: 220 }}
                  className="flex items-center gap-1.5 rounded-full border border-amber-400/60 bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-1 text-[#2a1c0a] shadow-[0_4px_14px_rgba(251,191,36,.4)]"
                >
                  <Coins className="h-3.5 w-3.5" />
                  <span className="text-sm font-black tabular-nums">+{sell.coinsEarned.toLocaleString()}</span>
                  <span className="text-[10px] font-bold">{t(lang, 'coins')}</span>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sequence progress bar (thin, bottom, only while selling) */}
      <AnimatePresence>
        {selling && sell && (
          <motion.div
            key="sell-progress"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="pointer-events-none absolute inset-x-0 bottom-2 z-30 flex justify-center px-4"
          >
            <div className="flex w-full max-w-md items-center gap-2">
              <Gauge className="h-3 w-3 shrink-0 text-amber-200/80" />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 via-amber-300 to-emerald-300"
                  animate={{ width: `${Math.round(sell.progress * 100)}%` }}
                  transition={{ duration: 0.15 }}
                />
              </div>
              <span className="w-9 text-right text-[10px] font-black tabular-nums text-amber-100/85">
                {Math.round(sell.progress * 100)}%
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
