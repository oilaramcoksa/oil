'use client';

// Real cryptocurrency logos as inline SVG.
// These are stylized representations of the official brand logos,
// drawn from scratch as SVG paths (no external images, instant load).
// Used in the Store screen for upgrade payment options.

interface Props {
  code: 'gram' | 'bnb' | 'tron' | 'btc';
  className?: string;
}

export function CryptoIcon({ code, className = 'w-6 h-6' }: Props) {
  switch (code) {
    case 'gram':
      // TON / GRAM — sky-blue diamond with white inner triangle
      return (
        <svg viewBox="0 0 32 32" className={className} aria-label="TON">
          <path d="M16 1.5 L30.5 16 L16 30.5 L1.5 16 Z" fill="#0098EA" />
          <path d="M8.5 10.5 H23.5 L16 24 Z" fill="#FFFFFF" />
          <path d="M8.5 10.5 L16 24 L23.5 10.5" stroke="#0098EA" strokeWidth="0.4" fill="none" opacity="0.3" />
        </svg>
      );
    case 'bnb':
      // BNB — golden yellow, 4 diamonds + center forming a larger diamond
      return (
        <svg viewBox="0 0 32 32" className={className} aria-label="BNB">
          {/* Top diamond */}
          <path d="M16 2.5 L21.5 8 L16 13.5 L10.5 8 Z" fill="#F3BA2F" />
          {/* Left diamond */}
          <path d="M8 8 L13.5 13.5 L8 19 L2.5 13.5 Z" fill="#F3BA2F" />
          {/* Right diamond */}
          <path d="M24 8 L29.5 13.5 L24 19 L18.5 13.5 Z" fill="#F3BA2F" />
          {/* Bottom diamond */}
          <path d="M16 13.5 L21.5 19 L16 24.5 L10.5 19 Z" fill="#F3BA2F" />
          {/* Center small diamond */}
          <path d="M16 11.5 L18.5 14 L16 16.5 L13.5 14 Z" fill="#F3BA2F" />
          {/* Center bottom small diamond */}
          <path d="M16 16.5 L18.5 19 L16 21.5 L13.5 19 Z" fill="#F3BA2F" />
          {/* Outermost accents (top/bottom tips) */}
          <path d="M16 24.5 L19 27.5 L16 30.5 L13 27.5 Z" fill="#F3BA2F" opacity="0" />
        </svg>
      );
    case 'tron':
      // TRON — red circle with stylized angular T (TRX logo style)
      return (
        <svg viewBox="0 0 32 32" className={className} aria-label="TRON">
          <circle cx="16" cy="16" r="15" fill="#EB0029" />
          {/* Stylized angular T with vertical stem */}
          <path
            d="M7 10 L25 10 L17.5 21 L17.5 26 L14.5 26 L14.5 21 Z"
            fill="#FFFFFF"
          />
          {/* Inner accent line */}
          <path
            d="M9.5 11.5 L22.5 11.5 L16 20.5 Z"
            fill="#EB0029"
            opacity="0.3"
          />
        </svg>
      );
    case 'btc':
      // Bitcoin — orange circle with white ₿ (B with two vertical strokes)
      return (
        <svg viewBox="0 0 32 32" className={className} aria-label="Bitcoin">
          <circle cx="16" cy="16" r="15" fill="#F7931A" />
          {/* Two vertical strokes (left side of the B) */}
          <rect x="10" y="6.5" width="1.4" height="19" fill="#FFFFFF" />
          <rect x="12.4" y="6.5" width="1.4" height="19" fill="#FFFFFF" />
          {/* B shape: top bump */}
          <path
            d="M13.8 6.5 h5.2 a4 4 0 0 1 0 8 h-5.2 Z"
            fill="#FFFFFF"
          />
          {/* B shape: bottom bump */}
          <path
            d="M13.8 14.5 h5.6 a4 4 0 0 1 0 8 h-5.6 Z"
            fill="#FFFFFF"
          />
        </svg>
      );
    default:
      return null;
  }
}
