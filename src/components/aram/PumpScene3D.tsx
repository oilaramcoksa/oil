'use client';

// React wrapper around the Three.js pump scene (src/lib/pumpScene3D.ts).
// Same prop contract as the legacy SVG PumpScene so PumpScreen wiring is
// unchanged: pumping, oilRatio, onTap, parts, specialParts. Additionally
// exposes an imperative triggerSell() so the host can play the truck
// arrival → transfer → departure sequence when a sell is initiated.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { createPumpScene, type PumpSceneHandles, type PumpSceneParts, type PumpSceneSpecial } from '@/lib/pumpScene3D';

export interface PumpScene3DProps {
  pumping: boolean;
  oilRatio: number;
  onTap: () => void;
  parts?: PumpSceneParts;
  specialParts?: PumpSceneSpecial;
}

export interface PumpScene3DHandle {
  triggerSell: () => void;
}

export const PumpScene3D = forwardRef<PumpScene3DHandle, PumpScene3DProps>(function PumpScene3D(
  { pumping, oilRatio, onTap, parts, specialParts },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const engineRef = useRef<PumpSceneHandles | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = createPumpScene(canvas, () => onTapRef.current());
    engineRef.current = engine;
    return () => { engine.dispose(); engineRef.current = null; };
  }, []);

  // Forward prop changes to the engine without recreating it.
  useEffect(() => { engineRef.current?.setPumping(pumping); }, [pumping]);
  useEffect(() => { engineRef.current?.setOilRatio(oilRatio); }, [oilRatio]);
  useEffect(() => { engineRef.current?.setParts(parts ?? {}); }, [parts]);
  useEffect(() => { engineRef.current?.setSpecialParts(specialParts ?? {}); }, [specialParts]);

  useImperativeHandle(ref, () => ({
    triggerSell: () => engineRef.current?.triggerSell(),
  }), []);

  return (
    <div className="relative h-full w-full select-none touch-none">
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_80px_rgba(0,0,0,.45)]" />
    </div>
  );
});
