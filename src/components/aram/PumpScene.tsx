'use client';

// Realistic Pump Scene — multi-layer SVG with gradients, filters, and
// detailed mechanical parts. No raster images, loads instantly.

import { memo, useRef, useState } from 'react';
import { motion } from 'framer-motion';

interface Props {
  pumping: boolean;
  oilRatio: number;
  onTap: () => void;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

export const PumpScene = memo(function PumpScene({ pumping, oilRatio, onTap }: Props) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const ridRef = useRef(0);

  // Day/night cycle: 06:00–17:59 = day, 18:00–05:59 = night.
  const hour = new Date().getHours();
  const isNight = hour < 6 || hour >= 18;

  const handleTap = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = ++ridRef.current;
    setRipples((r) => [...r, { id, x, y }]);
    setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), 700);
    onTap();
  };

  const storagePct = Math.max(0, Math.min(1, oilRatio)) * 100;

  return (
    <div
      className="relative w-full aspect-square max-h-[60vh] select-none touch-none"
      onPointerDown={handleTap}
    >
      <svg
        viewBox="0 0 400 400"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {/* === Sky === */}
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            {isNight ? (
              <>
                <stop offset="0%" stopColor="#0B1026" />
                <stop offset="40%" stopColor="#1E1B4B" />
                <stop offset="75%" stopColor="#3730A3" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#7C2D12" stopOpacity="0.5" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#FEF3C7" />
                <stop offset="25%" stopColor="#FED7AA" />
                <stop offset="55%" stopColor="#FB923C" />
                <stop offset="85%" stopColor="#C2410C" />
                <stop offset="100%" stopColor="#7C2D12" />
              </>
            )}
          </linearGradient>

          {/* Atmospheric haze for distant mountains */}
          <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
            {isNight ? (
              <>
                <stop offset="0%" stopColor="#1E1B4B" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#7C2D12" stopOpacity="0.3" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#FED7AA" stopOpacity="0.7" />
                <stop offset="100%" stopColor="#FB923C" stopOpacity="0.4" />
              </>
            )}
          </linearGradient>

          {/* === Sun (day) === */}
          <radialGradient id="sun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFBEB" />
            <stop offset="30%" stopColor="#FEF3C7" />
            <stop offset="70%" stopColor="#FBBF24" />
            <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sunCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="50%" stopColor="#FEF3C7" />
            <stop offset="100%" stopColor="#FCD34D" />
          </radialGradient>

          {/* === Moon (night) === */}
          <radialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FEF3C7" stopOpacity="0.4" />
            <stop offset="60%" stopColor="#FEF3C7" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#FEF3C7" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="moonSurface" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="60%" stopColor="#FEF3C7" />
            <stop offset="100%" stopColor="#D4D4D8" />
          </radialGradient>

          {/* Sun glow filter */}
          <filter id="sunGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Cloud soft blur */}
          <filter id="cloudBlur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" />
          </filter>

          {/* === Mountains === */}
          <linearGradient id="mtFar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#B45309" />
            <stop offset="100%" stopColor="#7C2D12" />
          </linearGradient>
          <linearGradient id="mtNear" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7C2D12" />
            <stop offset="100%" stopColor="#451A03" />
          </linearGradient>

          {/* === Sand === */}
          <linearGradient id="sand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F59E0B" />
            <stop offset="50%" stopColor="#D97706" />
            <stop offset="100%" stopColor="#92400E" />
          </linearGradient>
          <linearGradient id="sandShade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#92400E" stopOpacity="0" />
            <stop offset="100%" stopColor="#451A03" stopOpacity="0.6" />
          </linearGradient>

          {/* === Oil (in tank) === */}
          <linearGradient id="oil" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#292524" />
            <stop offset="50%" stopColor="#0C0A09" />
            <stop offset="100%" stopColor="#000000" />
          </linearGradient>
          <linearGradient id="oilShine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#1C1917" stopOpacity="0" />
            <stop offset="50%" stopColor="#78350F" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#1C1917" stopOpacity="0" />
          </linearGradient>

          {/* === Storage tank (metallic) === */}
          <linearGradient id="tankMetal" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#3F3F46" />
            <stop offset="30%" stopColor="#71717A" />
            <stop offset="50%" stopColor="#A1A1AA" />
            <stop offset="70%" stopColor="#71717A" />
            <stop offset="100%" stopColor="#3F3F46" />
          </linearGradient>
          <linearGradient id="tankTop" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#A1A1AA" />
            <stop offset="100%" stopColor="#52525B" />
          </linearGradient>

          {/* === Pump jack (red metallic) === */}
          <linearGradient id="pumpRed" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FCA5A5" />
            <stop offset="40%" stopColor="#DC2626" />
            <stop offset="100%" stopColor="#7F1D1D" />
          </linearGradient>
          <linearGradient id="pumpDark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#52525B" />
            <stop offset="100%" stopColor="#27272A" />
          </linearGradient>
          <linearGradient id="pumpSteel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D4D4D8" />
            <stop offset="50%" stopColor="#71717A" />
            <stop offset="100%" stopColor="#3F3F46" />
          </linearGradient>
          <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="40%" stopColor="#E4E4E7" />
            <stop offset="60%" stopColor="#A1A1AA" />
            <stop offset="100%" stopColor="#71717A" />
          </linearGradient>

          {/* Derrick steel */}
          <linearGradient id="derrick" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#52525B" />
            <stop offset="50%" stopColor="#A1A1AA" />
            <stop offset="100%" stopColor="#52525B" />
          </linearGradient>

          {/* Drop shadow filter */}
          <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.3" />
          </filter>
          <filter id="pumpShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="2" dy="3" stdDeviation="2.5" floodColor="#000" floodOpacity="0.45" />
          </filter>

          {/* Heat shimmer above sand */}
          <filter id="heatShimmer">
            <feTurbulence type="fractalNoise" baseFrequency="0.02 0.05" numOctaves="2" seed="2" />
            <feDisplacementMap in="SourceGraphic" scale="3" />
          </filter>

          {/* Cactus gradient */}
          <linearGradient id="cactus" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#14532D" />
            <stop offset="50%" stopColor="#16A34A" />
            <stop offset="100%" stopColor="#14532D" />
          </linearGradient>
        </defs>

        {/* === SKY === */}
        <rect x="0" y="0" width="400" height="290" fill="url(#sky)" />

        {/* Atmospheric haze layer */}
        <rect x="0" y="180" width="400" height="110" fill="url(#haze)" opacity={isNight ? 0.7 : 0.5} />

        {/* === NIGHT: stars + moon === */}
        {isNight && (
          <>
            {/* Stars */}
            <g fill="#FEF3C7">
              {Array.from({ length: 35 }).map((_, i) => {
                const sx = (i * 37 + 13) % 400;
                const sy = (i * 19 + 7) % 170;
                const r = i % 5 === 0 ? 1.4 : i % 3 === 0 ? 1 : 0.6;
                const op = 0.5 + (i % 4) * 0.12;
                return (
                  <circle key={i} cx={sx} cy={sy} r={r} opacity={op}>
                    <animate
                      attributeName="opacity"
                      values={`${op};${op * 0.3};${op}`}
                      dur={`${2 + (i % 3)}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                );
              })}
            </g>
            {/* Moon glow */}
            <circle cx="320" cy="75" r="50" fill="url(#moonGlow)" />
            {/* Moon body */}
            <g className="aram-sun-pulse" style={{ transformOrigin: '320px 75px' }}>
              <circle cx="320" cy="75" r="28" fill="url(#moonSurface)" />
              {/* Craters */}
              <circle cx="312" cy="68" r="3" fill="#A1A1AA" opacity="0.5" />
              <circle cx="326" cy="80" r="2" fill="#A1A1AA" opacity="0.4" />
              <circle cx="318" cy="84" r="1.5" fill="#A1A1AA" opacity="0.45" />
              <circle cx="328" cy="68" r="1.2" fill="#A1A1AA" opacity="0.4" />
            </g>
          </>
        )}

        {/* === DAY: sun === */}
        {!isNight && (
          <>
            <g filter="url(#sunGlow)">
              <circle cx="320" cy="75" r="55" fill="url(#sun)" opacity="0.7" />
            </g>
            <g className="aram-sun-pulse" style={{ transformOrigin: '320px 75px' }}>
              <circle cx="320" cy="75" r="32" fill="url(#sunCore)" />
              <circle cx="320" cy="75" r="32" fill="none" stroke="#FEF3C7" strokeWidth="1" opacity="0.5" />
              {/* Sun rays */}
              {Array.from({ length: 12 }).map((_, i) => {
                const angle = (i * 30) * Math.PI / 180;
                const x1 = 320 + Math.cos(angle) * 38;
                const y1 = 75 + Math.sin(angle) * 38;
                const x2 = 320 + Math.cos(angle) * 48;
                const y2 = 75 + Math.sin(angle) * 48;
                return (
                  <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FEF3C7" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />
                );
              })}
            </g>
          </>
        )}

        {/* === CLOUDS (day only) === */}
        {!isNight && (
          <g filter="url(#cloudBlur)" opacity="0.95">
            {/* Cloud 1 */}
            <g className="aram-cloud-drift">
              <ellipse cx="80" cy="55" rx="32" ry="16" fill="#FFFFFF" />
              <ellipse cx="105" cy="62" rx="26" ry="13" fill="#FFFFFF" />
              <ellipse cx="60" cy="65" rx="20" ry="11" fill="#FFFFFF" />
              <ellipse cx="90" cy="48" rx="18" ry="9" fill="#FFFFFF" opacity="0.9" />
            </g>
            {/* Cloud 2 */}
            <g className="aram-cloud-drift" style={{ animationDelay: '-2s', animationDuration: '8s' }}>
              <ellipse cx="200" cy="38" rx="24" ry="12" fill="#FFFFFF" opacity="0.9" />
              <ellipse cx="220" cy="45" rx="18" ry="9" fill="#FFFFFF" opacity="0.8" />
              <ellipse cx="185" cy="44" rx="14" ry="7" fill="#FFFFFF" opacity="0.7" />
            </g>
            {/* Cloud 3 - distant */}
            <g className="aram-cloud-drift" style={{ animationDelay: '-4s', animationDuration: '10s' }}>
              <ellipse cx="150" cy="80" rx="18" ry="8" fill="#FFFFFF" opacity="0.5" />
              <ellipse cx="165" cy="84" rx="12" ry="6" fill="#FFFFFF" opacity="0.4" />
            </g>
          </g>
        )}

        {/* === MOUNTAINS (multiple layers for depth) === */}
        {/* Far mountains - hazy */}
        <path
          d="M0 245 L40 215 L80 235 L120 210 L160 230 L200 205 L240 225 L280 200 L320 220 L360 210 L400 230 L400 290 L0 290 Z"
          fill="url(#mtFar)"
          opacity="0.4"
        />
        {/* Mid mountains */}
        <path
          d="M0 260 L50 225 L100 250 L150 220 L200 245 L250 215 L300 240 L350 225 L400 245 L400 290 L0 290 Z"
          fill="url(#mtFar)"
          opacity="0.6"
        />
        {/* Near hills */}
        <path
          d="M0 275 L60 250 L120 270 L180 245 L240 265 L300 245 L360 270 L400 255 L400 290 L0 290 Z"
          fill="url(#mtNear)"
          opacity="0.85"
        />

        {/* === SAND GROUND === */}
        <rect x="0" y="280" width="400" height="120" fill="url(#sand)" />
        {/* Sand dunes */}
        <path
          d="M0 295 Q 100 280 200 295 T 400 290 L400 320 L0 320 Z"
          fill="#FBBF24"
          opacity="0.3"
        />
        <path
          d="M0 320 Q 80 305 160 318 T 320 320 T 400 315 L400 350 L0 350 Z"
          fill="#D97706"
          opacity="0.2"
        />
        {/* Sand texture - ripple lines */}
        <g stroke="#92400E" fill="none" opacity="0.35">
          <path d="M0 300 Q 50 296 100 300 T 200 300 T 300 300 T 400 300" strokeWidth="1.5" />
          <path d="M0 312 Q 50 308 100 312 T 200 312 T 300 312 T 400 312" strokeWidth="1" opacity="0.7" />
          <path d="M0 325 Q 50 321 100 325 T 200 325 T 300 325 T 400 325" strokeWidth="1.2" />
          <path d="M0 340 Q 50 336 100 340 T 200 340 T 300 340 T 400 340" strokeWidth="1" opacity="0.6" />
          <path d="M0 358 Q 50 354 100 358 T 200 358 T 300 358 T 400 358" strokeWidth="1.5" />
          <path d="M0 378 Q 50 374 100 378 T 200 378 T 300 378 T 400 378" strokeWidth="1" opacity="0.5" />
        </g>
        {/* Sand particles / small rocks */}
        <g fill="#451A03" opacity="0.6">
          <circle cx="35" cy="335" r="1.5" />
          <circle cx="180" cy="345" r="1" />
          <circle cx="240" cy="320" r="1.2" />
          <circle cx="310" cy="365" r="1" />
          <circle cx="120" cy="370" r="1.5" />
          <circle cx="75" cy="358" r="0.8" />
        </g>
        {/* Sand shade gradient at bottom */}
        <rect x="0" y="280" width="400" height="120" fill="url(#sandShade)" />

        {/* === CACTI === */}
        {/* Cactus 1 */}
        <g transform="translate(40,255)" filter="url(#softShadow)">
          <rect x="0" y="0" width="9" height="38" rx="4.5" fill="url(#cactus)" />
          <rect x="-9" y="8" width="7" height="16" rx="3.5" fill="url(#cactus)" />
          <rect x="9" y="6" width="7" height="12" rx="3.5" fill="url(#cactus)" />
          <rect x="-7" y="14" width="5" height="3" fill="url(#cactus)" />
          <rect x="11" y="14" width="5" height="3" fill="url(#cactus)" />
          {/* Spines */}
          <g stroke="#FEF3C7" strokeWidth="0.5">
            <line x1="2" y1="5" x2="0" y2="3" />
            <line x1="6" y1="5" x2="8" y2="3" />
            <line x1="2" y1="15" x2="0" y2="13" />
            <line x1="6" y1="15" x2="8" y2="13" />
            <line x1="2" y1="25" x2="0" y2="23" />
            <line x1="6" y1="25" x2="8" y2="23" />
          </g>
          {/* Flower */}
          <circle cx="4.5" cy="-2" r="2.5" fill="#FBBF24" />
          <circle cx="4.5" cy="-2" r="1" fill="#DC2626" />
        </g>
        {/* Cactus 2 (smaller, distant) */}
        <g transform="translate(360,265) scale(0.75)" filter="url(#softShadow)" opacity="0.85">
          <rect x="0" y="0" width="8" height="34" rx="4" fill="url(#cactus)" />
          <rect x="-7" y="6" width="6" height="13" rx="3" fill="url(#cactus)" />
          <rect x="8" y="4" width="6" height="10" rx="3" fill="url(#cactus)" />
        </g>

        {/* === DISTANT DERRICK (background silhouette) === */}
        <g transform="translate(285,200)" opacity="0.5" filter="url(#softShadow)">
          {/* Tower legs */}
          <path d="M5 95 L25 20 L45 95 Z" fill="url(#derrick)" stroke="#27272A" strokeWidth="0.8" />
          {/* Cross-bracing */}
          <line x1="15" y1="60" x2="35" y2="60" stroke="#27272A" strokeWidth="1" />
          <line x1="12" y1="75" x2="38" y2="75" stroke="#27272A" strokeWidth="0.8" />
          <line x1="20" y1="45" x2="30" y2="45" stroke="#27272A" strokeWidth="0.7" />
          <line x1="10" y1="80" x2="40" y2="50" stroke="#27272A" strokeWidth="0.6" />
          <line x1="40" y1="80" x2="10" y2="50" stroke="#27272A" strokeWidth="0.6" />
          {/* Top */}
          <rect x="20" y="15" width="10" height="8" fill="url(#derrick)" />
          <rect x="22" y="10" width="6" height="6" fill="#71717A" />
        </g>

        {/* === OIL STORAGE TANK (left foreground) === */}
        <g transform="translate(35,225)" filter="url(#softShadow)">
          {/* Shadow ellipse on ground */}
          <ellipse cx="32" cy="55" rx="36" ry="6" fill="#000" opacity="0.3" />

          {/* Tank body — cylindrical look via horizontal gradient */}
          <rect x="0" y="8" width="64" height="48" fill="url(#tankMetal)" />

          {/* Tank top (slightly darker, simulating dome) */}
          <ellipse cx="32" cy="8" rx="32" ry="6" fill="url(#tankTop)" />
          <ellipse cx="32" cy="8" rx="32" ry="6" fill="none" stroke="#27272A" strokeWidth="0.6" />

          {/* Tank bottom rim */}
          <ellipse cx="32" cy="56" rx="32" ry="5" fill="#27272A" />

          {/* Welded seams (horizontal lines) */}
          <line x1="0" y1="22" x2="64" y2="22" stroke="#27272A" strokeWidth="0.6" opacity="0.7" />
          <line x1="0" y1="38" x2="64" y2="38" stroke="#27272A" strokeWidth="0.6" opacity="0.7" />

          {/* Rivets along seams */}
          <g fill="#27272A">
            {[6, 18, 30, 42, 54].map((x) => (
              <g key={x}>
                <circle cx={x} cy="22" r="0.8" />
                <circle cx={x} cy="38" r="0.8" />
              </g>
            ))}
          </g>

          {/* Inner window showing oil level */}
          <rect x="6" y="14" width="52" height="36" fill="#0C0A09" />
          {/* Oil fill */}
          <rect
            x="6"
            y={14 + 36 * (1 - storagePct / 100)}
            width="52"
            height={36 * (storagePct / 100)}
            fill="url(#oil)"
          />
          {/* Oil surface shine */}
          {storagePct > 5 && (
            <rect
              x="6"
              y={14 + 36 * (1 - storagePct / 100)}
              width="52"
              height="2"
              fill="#A16207"
              opacity="0.6"
            />
          )}
          {/* Glass reflection */}
          <rect x="6" y="14" width="52" height="36" fill="url(#oilShine)" opacity="0.3" />
          {/* Frame around window */}
          <rect x="6" y="14" width="52" height="36" fill="none" stroke="#3F3F46" strokeWidth="1" />

          {/* Specular highlight on tank (vertical strip on left) */}
          <rect x="10" y="14" width="3" height="36" fill="#FFFFFF" opacity="0.25" />

          {/* Tank label */}
          <rect x="20" y="28" width="24" height="8" fill="#FBBF24" opacity="0.85" />
          <text x="32" y="34" fontSize="5" fill="#27272A" textAnchor="middle" fontWeight="900" fontFamily="sans-serif">
            ARAMCO
          </text>

          {/* Outlet pipe at bottom */}
          <rect x="-6" y="48" width="14" height="4" fill="url(#pumpSteel)" />
          <circle cx="-6" cy="50" r="3" fill="url(#pumpSteel)" />
          {/* Valve wheel */}
          <circle cx="-12" cy="50" r="4" fill="none" stroke="#DC2626" strokeWidth="1.5" />
          <line x1="-16" y1="50" x2="-8" y2="50" stroke="#DC2626" strokeWidth="1" />
          <line x1="-12" y1="46" x2="-12" y2="54" stroke="#DC2626" strokeWidth="1" />

          {/* Status indicator light */}
          <circle cx="56" cy="14" r="2" fill={storagePct >= 95 ? '#EF4444' : '#22C55E'} />
          <circle cx="56" cy="14" r="2" fill={storagePct >= 95 ? '#EF4444' : '#22C55E'} opacity="0.5">
            <animate attributeName="r" values="2;3;2" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </g>

        {/* === OIL PLATFORM / CONCRETE BASE === */}
        <g filter="url(#softShadow)">
          {/* Shadow */}
          <ellipse cx="200" cy="295" rx="90" ry="8" fill="#000" opacity="0.35" />
          {/* Concrete base */}
          <rect x="120" y="275" width="160" height="20" rx="2" fill="#52525B" />
          <rect x="120" y="275" width="160" height="6" fill="#71717A" />
          {/* Concrete texture */}
          <g stroke="#27272A" strokeWidth="0.3" opacity="0.5">
            <line x1="140" y1="278" x2="140" y2="295" />
            <line x1="170" y1="278" x2="170" y2="295" />
            <line x1="200" y1="278" x2="200" y2="295" />
            <line x1="230" y1="278" x2="230" y2="295" />
            <line x1="260" y1="278" x2="260" y2="295" />
          </g>
          {/* Rust stains */}
          <ellipse cx="155" cy="293" rx="6" ry="1.5" fill="#92400E" opacity="0.5" />
          <ellipse cx="245" cy="293" rx="8" ry="1.5" fill="#92400E" opacity="0.4" />
        </g>

        {/* === PUMP JACK (center, detailed) === */}
        <g transform="translate(155,170)" filter="url(#pumpShadow)">
          {/* === Skid base / concrete pad === */}
          <rect x="0" y="118" width="90" height="6" fill="#3F3F46" />
          <rect x="0" y="118" width="90" height="2" fill="#71717A" />

          {/* === Electric motor (left side) === */}
          <g transform="translate(2,95)">
            {/* Motor housing */}
            <rect x="0" y="0" width="20" height="22" rx="2" fill="url(#pumpSteel)" />
            <rect x="0" y="0" width="20" height="6" rx="2" fill="#52525B" />
            {/* Cooling fins */}
            <g stroke="#27272A" strokeWidth="0.5">
              <line x1="3" y1="8" x2="17" y2="8" />
              <line x1="3" y1="12" x2="17" y2="12" />
              <line x1="3" y1="16" x2="17" y2="16" />
              <line x1="3" y1="20" x2="17" y2="20" />
            </g>
            {/* Junction box */}
            <rect x="2" y="-4" width="8" height="4" fill="#27272A" />
            {/* Cable */}
            <path d="M6 -2 Q 10 -8 14 -6" stroke="#1C1917" strokeWidth="1" fill="none" />
          </g>

          {/* === Belt drive (motor to gearbox) === */}
          <g transform="translate(22,100)">
            {/* Sheave (pulley) on motor side */}
            <circle cx="0" cy="10" r="4" fill="url(#pumpDark)" />
            <circle cx="0" cy="10" r="2" fill="#71717A" />
            {/* Sheave on gearbox side (larger) */}
            <circle cx="14" cy="10" r="6" fill="url(#pumpDark)" />
            <circle cx="14" cy="10" r="3" fill="#71717A" />
            <circle cx="14" cy="10" r="1" fill="#27272A" />
            {/* V-belt */}
            <path
              d="M 0 6 Q 7 4 14 4 L 14 16 Q 7 18 0 16 Z"
              fill="none"
              stroke="#1C1917"
              strokeWidth="1.5"
              opacity="0.8"
            />
          </g>

          {/* === Gear reducer / gearbox === */}
          <g transform="translate(35,98)">
            <rect x="0" y="0" width="18" height="22" rx="1" fill="url(#pumpSteel)" />
            <rect x="0" y="0" width="18" height="4" fill="#27272A" />
            {/* Bolts */}
            <g fill="#27272A">
              <circle cx="2" cy="2" r="0.8" />
              <circle cx="16" cy="2" r="0.8" />
              <circle cx="2" cy="20" r="0.8" />
              <circle cx="16" cy="20" r="0.8" />
            </g>
            {/* Inspection plate */}
            <rect x="3" y="7" width="12" height="8" fill="#52525B" stroke="#27272A" strokeWidth="0.3" />
            {/* Oil level sight glass */}
            <rect x="14" y="12" width="2" height="5" fill="#FBBF24" opacity="0.7" />
          </g>

          {/* === Crank (counter-weight, rotating) === */}
          <g transform="translate(54,98)">
            <circle cx="0" cy="6" r="9" fill="url(#pumpDark)" />
            <circle cx="0" cy="6" r="9" fill="none" stroke="#27272A" strokeWidth="0.8" />
            {/* Counter-weight crescent */}
            <path
              d="M -7 4 A 9 9 0 0 1 7 8 L 4 6 A 7 7 0 0 0 -4 4 Z"
              fill="#1C1917"
            />
            {/* Center hub */}
            <circle cx="0" cy="6" r="2.5" fill="#71717A" />
            <circle cx="0" cy="6" r="1" fill="#27272A" />
            {/* Crank pin (off-center, where pitman arm attaches) */}
            <circle cx="6" cy="2" r="1.5" fill="url(#chrome)" />
            <circle cx="6" cy="2" r="0.5" fill="#27272A" />
          </g>

          {/* === Samson post (A-frame vertical support) === */}
          <g transform="translate(45,55)">
            {/* Left leg */}
            <path d="M 0 50 L 5 0 L 7 0 L 2 50 Z" fill="url(#pumpRed)" />
            {/* Right leg */}
            <path d="M 12 50 L 7 0 L 5 0 L 10 50 Z" fill="url(#pumpRed)" />
            {/* Cross-bracing */}
            <line x1="2" y1="35" x2="10" y2="15" stroke="#7F1D1D" strokeWidth="1" />
            <line x1="10" y1="35" x2="2" y2="15" stroke="#7F1D1D" strokeWidth="1" />
            {/* Top bearing housing */}
            <rect x="3" y="-2" width="6" height="4" rx="1" fill="url(#pumpSteel)" />
            <circle cx="6" cy="0" r="1" fill="#27272A" />
          </g>

          {/* === Walking beam (rocks back and forth) === */}
          <g
            className={pumping ? 'aram-pump-rock' : ''}
            style={{ transformOrigin: '51px 55px' }}
          >
            {/* Beam (long horizontal piece) */}
            <rect x="6" y="52" width="92" height="6" rx="2" fill="url(#pumpRed)" />
            {/* Highlight on top of beam */}
            <rect x="8" y="52" width="88" height="1.5" fill="#FCA5A5" opacity="0.7" />
            {/* Bolt heads on beam */}
            <g fill="#27272A">
              <circle cx="14" cy="55" r="0.8" />
              <circle cx="86" cy="55" r="0.8" />
              <circle cx="50" cy="55" r="0.8" />
            </g>

            {/* === Horse head (front curved end) === */}
            <g transform="translate(96,48)">
              <path
                d="M 0 8 Q 8 4 10 -4 L 12 -2 Q 10 6 4 12 L 2 10 Z"
                fill="url(#pumpRed)"
              />
              {/* Wear plate */}
              <path d="M 4 6 L 10 0" stroke="#7F1D1D" strokeWidth="0.8" />
            </g>

            {/* === Counter-weight (back end, heavy box) === */}
            <g transform="translate(-12,46)">
              <rect x="0" y="0" width="14" height="18" rx="1" fill="url(#pumpDark)" />
              <rect x="0" y="0" width="14" height="3" fill="#27272A" />
              {/* Concrete fill look */}
              <g stroke="#27272A" strokeWidth="0.4" opacity="0.6">
                <line x1="2" y1="6" x2="12" y2="6" />
                <line x1="2" y1="10" x2="12" y2="10" />
                <line x1="2" y1="14" x2="12" y2="14" />
              </g>
              {/* Weight label */}
              <text x="7" y="12" fontSize="3" fill="#A1A1AA" textAnchor="middle" fontWeight="900">W</text>
            </g>

            {/* === Pitman arm (connects crank to beam) === */}
            <g transform="translate(58,50)">
              <rect x="-1.5" y="0" width="3" height="22" fill="url(#pumpSteel)" />
              <rect x="-1.5" y="0" width="3" height="2" fill="#A1A1AA" />
              {/* Bearings at ends */}
              <circle cx="0" cy="0" r="1.5" fill="#27272A" />
              <circle cx="0" cy="22" r="1.5" fill="#27272A" />
            </g>

            {/* === Bridle (wire rope from horse head to polished rod) === */}
            <g transform="translate(102,52)">
              <line x1="0" y1="0" x2="0" y2="20" stroke="#1C1917" strokeWidth="1" />
              {/* Bridle clamp */}
              <rect x="-1.5" y="8" width="3" height="2" fill="#71717A" />
            </g>

            {/* === Polished rod (shiny vertical rod into well) === */}
            <g transform="translate(100,72)">
              <rect x="-0.5" y="0" width="1" height="20" fill="url(#chrome)" />
              {/* Polished rod clamp */}
              <rect x="-2" y="0" width="4" height="3" fill="url(#pumpSteel)" />
              <line x1="-2" y1="1" x2="2" y2="1" stroke="#27272A" strokeWidth="0.3" />
            </g>
          </g>

          {/* === Stuffing box (seal around polished rod) === */}
          <g transform="translate(99,92)">
            <rect x="-3" y="0" width="6" height="6" fill="url(#pumpSteel)" />
            <rect x="-3" y="0" width="6" height="2" fill="#52525B" />
            {/* Bolt on stuffing box */}
            <circle cx="-2" cy="3" r="0.6" fill="#27272A" />
            <circle cx="2" cy="3" r="0.6" fill="#27272A" />
          </g>

          {/* === Well head (flange + valves) === */}
          <g transform="translate(95,98)">
            {/* Flange */}
            <rect x="-6" y="0" width="12" height="3" fill="url(#pumpSteel)" />
            <rect x="-7" y="3" width="14" height="2" fill="#52525B" />
            {/* Flange bolt circle */}
            <g fill="#27272A">
              <circle cx="-4" cy="1.5" r="0.5" />
              <circle cx="0" cy="1.5" r="0.5" />
              <circle cx="4" cy="1.5" r="0.5" />
            </g>
            {/* Wellhead body */}
            <rect x="-4" y="5" width="8" height="14" fill="url(#pumpDark)" />
            {/* Side outlet valve */}
            <rect x="-10" y="9" width="6" height="3" fill="url(#pumpSteel)" />
            <circle cx="-11" cy="10.5" r="2" fill="none" stroke="#DC2626" strokeWidth="0.8" />
            {/* Pressure gauge */}
            <circle cx="6" cy="12" r="2" fill="#FEF3C7" stroke="#27272A" strokeWidth="0.5" />
            <line x1="6" y1="12" x2="7" y2="11" stroke="#DC2626" strokeWidth="0.5" />
          </g>

          {/* === Flow line (pipe going off-screen to storage) === */}
          <g transform="translate(0,108)">
            <rect x="0" y="0" width="35" height="3" fill="url(#pumpSteel)" />
            <rect x="0" y="0" width="35" height="1" fill="#A1A1AA" />
            {/* Pipe supports */}
            <rect x="8" y="3" width="1.5" height="6" fill="#52525B" />
            <rect x="22" y="3" width="1.5" height="6" fill="#52525B" />
          </g>
        </g>

        {/* === Heat shimmer (subtle) — above ground === */}
        <rect
          x="0"
          y="278"
          width="400"
          height="15"
          fill="url(#haze)"
          opacity="0.25"
          filter="url(#heatShimmer)"
        />

        {/* === Foreground dust particles (atmosphere) === */}
        <g opacity="0.4">
          <circle cx="100" cy="320" r="0.5" fill="#FFFFFF">
            <animate attributeName="cy" values="320;310;320" dur="3s" repeatCount="indefinite" />
          </circle>
          <circle cx="280" cy="340" r="0.5" fill="#FFFFFF">
            <animate attributeName="cy" values="340;325;340" dur="4s" repeatCount="indefinite" />
          </circle>
          <circle cx="60" cy="355" r="0.4" fill="#FFFFFF">
            <animate attributeName="cy" values="355;340;355" dur="3.5s" repeatCount="indefinite" />
          </circle>
        </g>

        {/* === Tap hint badge (no black frame — just a soft amber text) === */}
        {oilRatio < 0.05 && !pumping && (
          <motion.g
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <text
              x="200"
              y="174"
              fontSize="13"
              fill={isNight ? "#FEF3C7" : "#7C2D12"}
              textAnchor="middle"
              fontWeight="900"
              fontFamily="sans-serif"
              stroke={isNight ? "#0B1026" : "#FEF3C7"}
              strokeWidth="3"
              paintOrder="stroke"
              style={{ filter: isNight ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' : 'none' }}
            >
              اضغط على المضخة · Tap the pump
            </text>
          </motion.g>
        )}
      </svg>

      {/* Tap ripples (DOM overlay for crisp pointer feedback) */}
      {ripples.map((r) => (
        <span
          key={r.id}
          className="aram-tap-ripple"
          style={{
            left: r.x - 20,
            top: r.y - 20,
            width: 40,
            height: 40,
          }}
        />
      ))}
    </div>
  );
});
