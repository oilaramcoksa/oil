'use client';

// SellModal: the full oil-sell animation sequence.
// 1. Truck drives in from the right
// 2. Truck backs up to the pump
// 3. Pipe extends from truck to pump
// 4. Pump activates, oil flows
// 5. Counter ticks up showing oil collected
// 6. Coins earned popup, modal closes

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '@/lib/store';
import { t } from '@/lib/i18n';
import { useTelegram } from '@/hooks/use-telegram';
import { Button } from '@/components/ui/button';
import { Truck, X, Droplet, Coins, Check } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Phase = 'arriving' | 'connecting' | 'pumping' | 'counting' | 'done';

export function SellModal({ open, onClose }: Props) {
  const lang = useGame((s) => s.lang);
  const oilBefore = useGame((s) => s.oil);
  const sellOil = useGame((s) => s.sellOil);
  const { haptic, notify } = useTelegram();

  const [phase, setPhase] = useState<Phase>('arriving');
  const [counter, setCounter] = useState(0);
  const [result, setResult] = useState<{ sold: number; coinsEarned: number } | null>(null);
  const soldRef = useRef(0);

  useEffect(() => {
    if (!open) {
      // Defer state resets to avoid cascading renders in effect body.
      queueMicrotask(() => {
        setPhase('arriving');
        setCounter(0);
        setResult(null);
      });
      soldRef.current = 0;
      return;
    }

    // Sequence timing
    const timers: ReturnType<typeof setTimeout>[] = [];

    // After truck arrives → connect pipe
    timers.push(setTimeout(() => {
      setPhase('connecting');
      haptic('light');
    }, 1700));

    // After pipe connects → pump
    timers.push(setTimeout(() => {
      setPhase('pumping');
      haptic('medium');
    }, 2400));

    // After pumping → count + execute sell
    timers.push(setTimeout(() => {
      setPhase('counting');
      const r = sellOil();
      soldRef.current = r.sold;
      // Animate counter from 0 to r.sold
      const start = performance.now();
      const duration = Math.min(1400, 600 + r.sold * 6);
      const animate = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        setCounter(Math.round(r.sold * eased));
        if (t < 1) requestAnimationFrame(animate);
        else {
          setResult(r);
          setPhase('done');
          notify('success');
        }
      };
      requestAnimationFrame(animate);
    }, 4200));

    return () => timers.forEach(clearTimeout);
  }, [open]);

  // Pre-capture the oil at the moment of opening so the displayed number
  // matches what we sold even though sellOil zeroes it.
  const oilDisplay = open ? (result ? result.sold : Math.max(oilBefore, counter)) : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 220 }}
            className="relative w-full max-w-md bg-gradient-to-b from-[#2a1c0a] to-[#0c0703] rounded-t-3xl sm:rounded-3xl overflow-hidden aram-safe-bottom"
            style={{ aspectRatio: '4 / 5', maxHeight: '90vh' }}
          >
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Droplet className="w-5 h-5 text-amber-400" />
                <h3 className="text-amber-100 font-bold text-base">
                  {t(lang, 'sellTitle')}
                </h3>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                aria-label="close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scene */}
            <div className="absolute inset-0 overflow-hidden">
              <svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
                <defs>
                  {/* Sunset sky */}
                  <linearGradient id="m-sky" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1E1B4B" />
                    <stop offset="25%" stopColor="#7C2D12" />
                    <stop offset="55%" stopColor="#C2410C" />
                    <stop offset="85%" stopColor="#F59E0B" />
                    <stop offset="100%" stopColor="#FCD34D" />
                  </linearGradient>
                  <radialGradient id="m-sun" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#FEF3C7" />
                    <stop offset="60%" stopColor="#FBBF24" />
                    <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
                  </radialGradient>
                  <linearGradient id="m-ground" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7C2D12" />
                    <stop offset="50%" stopColor="#451A03" />
                    <stop offset="100%" stopColor="#1C1917" />
                  </linearGradient>
                  <linearGradient id="m-tank" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#3F3F46" />
                    <stop offset="30%" stopColor="#A1A1AA" />
                    <stop offset="50%" stopColor="#D4D4D8" />
                    <stop offset="70%" stopColor="#A1A1AA" />
                    <stop offset="100%" stopColor="#3F3F46" />
                  </linearGradient>
                  <linearGradient id="m-tankTop" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#A1A1AA" />
                    <stop offset="100%" stopColor="#52525B" />
                  </linearGradient>
                  <linearGradient id="m-oil" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#292524" />
                    <stop offset="100%" stopColor="#000000" />
                  </linearGradient>
                  <linearGradient id="m-pump" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#FCA5A5" />
                    <stop offset="50%" stopColor="#DC2626" />
                    <stop offset="100%" stopColor="#7F1D1D" />
                  </linearGradient>
                  <linearGradient id="m-steel" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#D4D4D8" />
                    <stop offset="50%" stopColor="#71717A" />
                    <stop offset="100%" stopColor="#3F3F46" />
                  </linearGradient>
                  <linearGradient id="m-truckTank" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#92400E" />
                    <stop offset="30%" stopColor="#FBBF24" />
                    <stop offset="50%" stopColor="#FEF3C7" />
                    <stop offset="70%" stopColor="#FBBF24" />
                    <stop offset="100%" stopColor="#92400E" />
                  </linearGradient>
                  <linearGradient id="m-truckCab" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#FCA5A5" />
                    <stop offset="50%" stopColor="#DC2626" />
                    <stop offset="100%" stopColor="#7F1D1D" />
                  </linearGradient>
                  <linearGradient id="m-window" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FEF3C7" />
                    <stop offset="50%" stopColor="#FBBF24" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#92400E" stopOpacity="0.6" />
                  </linearGradient>
                  <radialGradient id="m-headlight" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#FFFFFF" />
                    <stop offset="40%" stopColor="#FEF3C7" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#FBBF24" stopOpacity="0" />
                  </radialGradient>
                  <filter id="m-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="6" />
                  </filter>
                  <filter id="m-softShadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000" floodOpacity="0.5" />
                  </filter>
                </defs>

                {/* Sky */}
                <rect x="0" y="0" width="400" height="370" fill="url(#m-sky)" />

                {/* Sun setting on horizon */}
                <g filter="url(#m-glow)">
                  <circle cx="320" cy="280" r="55" fill="url(#m-sun)" opacity="0.7" />
                </g>
                <circle cx="320" cy="280" r="28" fill="#FEF3C7" />
                <circle cx="320" cy="280" r="28" fill="url(#m-sun)" />

                {/* Stars (top of sky) */}
                <g fill="#FEF3C7">
                  {[...Array(15)].map((_, i) => {
                    const x = (i * 37) % 400;
                    const y = (i * 13) % 80;
                    return <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1 : 0.5} opacity={0.6 + (i % 3) * 0.15} />;
                  })}
                </g>

                {/* Distant mountains */}
                <path d="M0 320 L60 280 L120 305 L180 275 L240 300 L300 280 L360 295 L400 285 L400 370 L0 370 Z" fill="#451A03" opacity="0.7" />
                <path d="M0 340 L80 310 L160 335 L240 305 L320 330 L400 315 L400 370 L0 370 Z" fill="#7C2D12" opacity="0.8" />

                {/* Horizon glow */}
                <rect x="0" y="320" width="400" height="50" fill="#FBBF24" opacity="0.15" />

                {/* Ground */}
                <rect x="0" y="345" width="400" height="155" fill="url(#m-ground)" />
                {/* Ground texture */}
                <g stroke="#1C1917" fill="none" opacity="0.5">
                  <path d="M0 360 Q 100 357 200 360 T 400 360" strokeWidth="1" />
                  <path d="M0 380 Q 80 376 160 380 T 320 380 T 400 378" strokeWidth="0.8" />
                  <path d="M0 405 Q 60 402 120 405 T 240 405 T 360 405 T 400 405" strokeWidth="1" />
                  <path d="M0 435 Q 90 432 180 435 T 360 435 T 400 435" strokeWidth="0.7" />
                </g>

                {/* === Storage tank (left) === */}
                <g transform="translate(15,310)" filter="url(#m-softShadow)">
                  <ellipse cx="40" cy="55" rx="42" ry="6" fill="#000" opacity="0.4" />
                  <rect x="0" y="8" width="80" height="48" fill="url(#m-tank)" />
                  <ellipse cx="40" cy="8" rx="40" ry="6" fill="url(#m-tankTop)" />
                  <ellipse cx="40" cy="56" rx="40" ry="5" fill="#27272A" />
                  <line x1="0" y1="22" x2="80" y2="22" stroke="#27272A" strokeWidth="0.6" />
                  <line x1="0" y1="38" x2="80" y2="38" stroke="#27272A" strokeWidth="0.6" />
                  <g fill="#27272A">
                    {[8, 24, 40, 56, 72].map((x) => (
                      <g key={x}>
                        <circle cx={x} cy="22" r="0.8" />
                        <circle cx={x} cy="38" r="0.8" />
                      </g>
                    ))}
                  </g>
                  {/* Inner oil view */}
                  <rect x="6" y="14" width="68" height="36" fill="#0C0A09" />
                  <rect
                    x="6"
                    y={14 + 36 * (phase === 'pumping' || phase === 'counting' || phase === 'done' ? 1 : 0.15)}
                    width="68"
                    height={36 * (phase === 'pumping' || phase === 'counting' || phase === 'done' ? 0 : 0.85)}
                    fill="url(#m-oil)"
                  />
                  <rect x="6" y="14" width="68" height="36" fill="none" stroke="#3F3F46" strokeWidth="1" />
                  <rect x="14" y="14" width="4" height="36" fill="#FFFFFF" opacity="0.2" />
                  <rect x="26" y="28" width="28" height="8" fill="#FBBF24" opacity="0.85" />
                  <text x="40" y="34" fontSize="6" fill="#27272A" textAnchor="middle" fontWeight="900" fontFamily="sans-serif">ARAMCO</text>
                  <circle cx="72" cy="14" r="2" fill={phase === 'pumping' ? '#EF4444' : '#22C55E'} />
                </g>

                {/* === Pump jack (center) === */}
                <g transform="translate(160,225)" filter="url(#m-softShadow)">
                  {/* Concrete base */}
                  <rect x="-10" y="105" width="90" height="14" rx="2" fill="#52525B" />
                  <rect x="-10" y="105" width="90" height="4" fill="#71717A" />
                  {/* Samson post */}
                  <g transform="translate(30,55)">
                    <path d="M 0 50 L 5 0 L 7 0 L 2 50 Z" fill="url(#m-pump)" />
                    <path d="M 12 50 L 7 0 L 5 0 L 10 50 Z" fill="url(#m-pump)" />
                    <line x1="2" y1="35" x2="10" y2="15" stroke="#7F1D1D" strokeWidth="1" />
                    <line x1="10" y1="35" x2="2" y2="15" stroke="#7F1D1D" strokeWidth="1" />
                    <rect x="3" y="-2" width="6" height="4" rx="1" fill="url(#m-steel)" />
                  </g>
                  {/* Walking beam */}
                  <g
                    className={phase === 'connecting' || phase === 'pumping' || phase === 'counting' ? 'aram-pump-rock' : ''}
                    style={{ transformOrigin: '36px 55px' }}
                  >
                    <rect x="-10" y="52" width="92" height="6" rx="2" fill="url(#m-pump)" />
                    <rect x="-8" y="52" width="88" height="1.5" fill="#FCA5A5" opacity="0.7" />
                    {/* Horse head */}
                    <path d="M 80 50 Q 88 46 90 38 L 92 40 Q 90 48 84 54 L 82 52 Z" fill="url(#m-pump)" />
                    {/* Counter-weight */}
                    <rect x="-22" y="46" width="14" height="18" rx="1" fill="#27272A" />
                    <rect x="-22" y="46" width="14" height="3" fill="#1C1917" />
                    <text x="-15" y="58" fontSize="4" fill="#A1A1AA" textAnchor="middle" fontWeight="900">W</text>
                    {/* Pitman arm */}
                    <rect x="44" y="50" width="3" height="22" fill="url(#m-steel)" />
                    {/* Bridle */}
                    <line x1="86" y1="52" x2="86" y2="72" stroke="#1C1917" strokeWidth="1" />
                    {/* Polished rod */}
                    <rect x="85.5" y="72" width="1" height="20" fill="#FFFFFF" />
                    <rect x="84" y="72" width="4" height="3" fill="url(#m-steel)" />
                  </g>
                  {/* Crank */}
                  <g transform="translate(40,98)">
                    <circle cx="0" cy="6" r="9" fill="#27272A" />
                    <circle cx="0" cy="6" r="2.5" fill="#71717A" />
                    <circle cx="6" cy="2" r="1.5" fill="#D4D4D8" />
                  </g>
                  {/* Well head */}
                  <g transform="translate(81,92)">
                    <rect x="-6" y="0" width="12" height="3" fill="url(#m-steel)" />
                    <rect x="-4" y="5" width="8" height="14" fill="#27272A" />
                    <circle cx="6" cy="12" r="2" fill="#FEF3C7" stroke="#27272A" strokeWidth="0.5" />
                  </g>
                </g>

                {/* === Oil truck (right) === */}
                <motion.g
                  initial={{ x: 380 }}
                  animate={{ x: phase === 'arriving' ? 0 : 0 }}
                  transition={{ duration: 1.6, ease: [0.2, 0.7, 0.2, 1] }}
                >
                  <g transform="translate(180,300)" filter="url(#m-softShadow)">
                    {/* Ground shadow */}
                    <ellipse cx="100" cy="68" rx="105" ry="6" fill="#000" opacity="0.5" />

                    {/* === Tank trailer === */}
                    {/* End cap (left dome) */}
                    <ellipse cx="5" cy="40" rx="6" ry="22" fill="#92400E" />
                    {/* Main tank body */}
                    <rect x="5" y="18" width="130" height="44" fill="url(#m-truckTank)" />
                    {/* Right dome */}
                    <ellipse cx="135" cy="40" rx="6" ry="22" fill="#FBBF24" />
                    {/* Top rail */}
                    <rect x="5" y="18" width="130" height="3" fill="#FFFFFF" opacity="0.4" />
                    {/* Bottom rail */}
                    <rect x="5" y="59" width="130" height="3" fill="#451A03" />

                    {/* Tank bands/rings (3 of them) */}
                    <rect x="35" y="18" width="3" height="44" fill="#451A03" opacity="0.7" />
                    <rect x="70" y="18" width="3" height="44" fill="#451A03" opacity="0.7" />
                    <rect x="105" y="18" width="3" height="44" fill="#451A03" opacity="0.7" />
                    {/* Highlight stripe */}
                    <rect x="5" y="22" width="130" height="2" fill="#FEF3C7" opacity="0.5" />
                    {/* ARAMCO logo on tank */}
                    <rect x="45" y="32" width="50" height="14" rx="2" fill="#DC2626" />
                    <text x="70" y="42" fontSize="9" fill="#FEF3C7" textAnchor="middle" fontWeight="900" fontFamily="sans-serif">ARAMCO</text>
                    {/* Rivets along bands */}
                    <g fill="#451A03">
                      <circle cx="36.5" cy="22" r="0.6" />
                      <circle cx="36.5" cy="58" r="0.6" />
                      <circle cx="71.5" cy="22" r="0.6" />
                      <circle cx="71.5" cy="58" r="0.6" />
                      <circle cx="106.5" cy="22" r="0.6" />
                      <circle cx="106.5" cy="58" r="0.6" />
                    </g>

                    {/* === Cabin === */}
                    {/* Hood */}
                    <path d="M 145 28 L 175 28 L 175 60 L 145 60 Z" fill="url(#m-truckCab)" />
                    {/* Windshield */}
                    <path d="M 147 30 L 173 30 L 173 45 L 147 45 Z" fill="url(#m-window)" />
                    <line x1="160" y1="30" x2="160" y2="45" stroke="#7F1D1D" strokeWidth="0.5" />
                    {/* Roof */}
                    <rect x="145" y="28" width="30" height="2" fill="#FCA5A5" />
                    {/* Door panel */}
                    <rect x="145" y="45" width="30" height="15" fill="#DC2626" />
                    {/* Door handle */}
                    <rect x="170" y="50" width="3" height="1.5" fill="#27272A" />
                    {/* Side mirror */}
                    <rect x="142" y="32" width="3" height="6" rx="1" fill="#27272A" />
                    <rect x="141" y="33" width="2" height="4" fill="#A1A1AA" />
                    {/* Headlight */}
                    <circle cx="173" cy="55" r="3" fill="url(#m-headlight)" />
                    <circle cx="173" cy="55" r="2" fill="#FFFFFF" />
                    {phase === 'arriving' && (
                      <g filter="url(#m-glow)">
                        <circle cx="178" cy="55" r="8" fill="#FEF3C7" opacity="0.7" />
                      </g>
                    )}
                    {/* Grille */}
                    <g stroke="#27272A" strokeWidth="0.4">
                      <line x1="171" y1="48" x2="171" y2="58" />
                      <line x1="173" y1="48" x2="173" y2="58" />
                      <line x1="175" y1="48" x2="175" y2="58" />
                    </g>
                    {/* Front bumper */}
                    <rect x="143" y="58" width="34" height="3" fill="url(#m-steel)" />
                    {/* Exhaust stack */}
                    <rect x="140" y="14" width="2.5" height="18" fill="url(#m-steel)" />
                    <ellipse cx="141.25" cy="14" rx="1.5" ry="1" fill="#27272A" />

                    {/* === Wheels === */}
                    {[
                      { x: 25, label: 'a' },
                      { x: 60, label: 'b' },
                      { x: 110, label: 'c' },
                      { x: 160, label: 'd' },
                    ].map((w) => (
                      <g key={w.label}>
                        {/* Outer tire */}
                        <circle cx={w.x} cy="62" r="9" fill="#0C0A09" />
                        <circle cx={w.x} cy="62" r="8.5" fill="#1C1917" />
                        {/* Rim */}
                        <circle cx={w.x} cy="62" r="5" fill="url(#m-steel)" />
                        <circle cx={w.x} cy="62" r="4.5" fill="#52525B" />
                        {/* Lug nuts */}
                        <g fill="#27272A">
                          {[0, 72, 144, 216, 288].map((deg) => {
                            const r = (deg * Math.PI) / 180;
                            return (
                              <circle
                                key={deg}
                                cx={w.x + Math.cos(r) * 2.5}
                                cy={62 + Math.sin(r) * 2.5}
                                r="0.6"
                              />
                            );
                          })}
                        </g>
                        {/* Hub center */}
                        <circle cx={w.x} cy="62" r="1.2" fill="#27272A" />
                      </g>
                    ))}

                    {/* Reverse lights (when arriving) */}
                    {phase === 'arriving' && (
                      <g>
                        <rect x="2" y="38" width="4" height="3" fill="#FEF3C7" />
                        <rect x="2" y="44" width="4" height="3" fill="#FEF3C7" />
                        <g filter="url(#m-glow)">
                          <circle cx="2" cy="40" r="6" fill="#FEF3C7" opacity="0.6" />
                          <circle cx="2" cy="46" r="6" fill="#FEF3C7" opacity="0.6" />
                        </g>
                      </g>
                    )}

                    {/* === Connecting pipe (when phase is connecting/pumping/counting) === */}
                    {(phase === 'connecting' || phase === 'pumping' || phase === 'counting') && (
                      <g className="aram-pipe-extend" style={{ transformOrigin: '5px 40px' }}>
                        {/* Pipe */}
                        <rect x="-160" y="38" width="160" height="5" fill="url(#m-steel)" />
                        <rect x="-160" y="38" width="160" height="1.5" fill="#D4D4D8" />
                        {/* Pipe joints */}
                        <rect x="-130" y="36" width="3" height="9" fill="#52525B" />
                        <rect x="-90" y="36" width="3" height="9" fill="#52525B" />
                        <rect x="-50" y="36" width="3" height="9" fill="#52525B" />
                        {/* Flange at tank end */}
                        <rect x="-3" y="35" width="6" height="11" fill="#27272A" />
                        {/* Flow indicator */}
                        {(phase === 'pumping' || phase === 'counting') && (
                          <g className="aram-oil-flow">
                            <rect x="-150" y="39" width="20" height="3" fill="#0C0A09" opacity="0.7" />
                          </g>
                        )}
                      </g>
                    )}
                  </g>
                </motion.g>

                {/* Dust particles near truck when arriving */}
                {phase === 'arriving' && (
                  <g opacity="0.5">
                    {[180, 200, 220, 240].map((x, i) => (
                      <circle key={i} cx={x} cy={350 + (i % 2) * 5} r={1 + (i % 2)} fill="#D97706">
                        <animate
                          attributeName="cx"
                          values={`${x};${x - 30}`}
                          dur="1.2s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="opacity"
                          values="0.6;0"
                          dur="1.2s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    ))}
                  </g>
                )}
              </svg>
            </div>

              {/* Status text */}
              <div className="absolute top-16 left-0 right-0 text-center">
                <div className="inline-block px-4 py-2 rounded-full bg-black/60 text-amber-100 text-sm font-bold">
                  {phase === 'arriving' && (
                    <span className="flex items-center gap-2">
                      <Truck className="w-4 h-4 animate-pulse" />
                      {t(lang, 'truckArriving')}
                    </span>
                  )}
                  {phase === 'connecting' && (
                    <span className="flex items-center gap-2">
                      🔗 {t(lang, 'truckConnecting')}
                    </span>
                  )}
                  {phase === 'pumping' && (
                    <span className="flex items-center gap-2">
                      <Droplet className="w-4 h-4 animate-bounce" />
                      {t(lang, 'pumping')}
                    </span>
                  )}
                  {phase === 'counting' && (
                    <span className="flex items-center gap-2">
                      <Droplet className="w-4 h-4" />
                      {t(lang, 'counting')}
                    </span>
                  )}
                  {phase === 'done' && (
                    <span className="flex items-center gap-2 text-emerald-300">
                      <Check className="w-4 h-4" />
                      {t(lang, 'done')}
                    </span>
                  )}
                </div>
              </div>

              {/* Counter (oil collected) */}
              {(phase === 'counting' || phase === 'done') && (
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="absolute left-1/2 -translate-x-1/2 top-28 text-center"
                >
                  <div className="text-amber-100/80 text-xs mb-1">{t(lang, 'collected')}</div>
                  <div className="text-4xl font-black text-amber-400 tabular-nums">
                    {counter}
                    <span className="text-base ml-1 text-amber-200/70">{t(lang, 'oil')}</span>
                  </div>
                </motion.div>
              )}

              {/* Final coins earned popup */}
              {phase === 'done' && result && (
                <motion.div
                  initial={{ y: 30, opacity: 0, scale: 0.8 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', damping: 14, stiffness: 200 }}
                  className="absolute left-1/2 -translate-x-1/2 bottom-[42%] text-center"
                >
                  <div className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 text-[#2a1c0a] font-black shadow-2xl">
                    <Coins className="w-6 h-6" />
                    <span className="text-2xl tabular-nums">+{result.coinsEarned.toLocaleString()}</span>
                    <span className="text-sm">{t(lang, 'coins')}</span>
                  </div>
                  <div className="text-amber-200/80 text-xs mt-2">{t(lang, 'earned')}</div>
                </motion.div>
              )}

            {/* Close button */}
            <div className="absolute bottom-4 left-0 right-0 px-4 z-10">
              <Button
                onClick={onClose}
                disabled={phase !== 'done'}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 text-[#2a1c0a] font-bold text-base disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {phase === 'done' ? t(lang, 'close') : `${t(lang, 'pumping')}...`}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
