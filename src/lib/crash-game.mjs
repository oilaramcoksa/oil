import { createHash } from 'node:crypto';

const MAX_MULTIPLIER = 1000;

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function makeCrashPoint(seed, roundId, maxMultiplier = MAX_MULTIPLIER) {
  const value = Number(BigInt('0x' + sha256(seed + ':' + roundId).slice(0, 8))) / 0x1_0000_0000;
  // A small seed-derived chance of a weather-related failure before takeoff.
  // It is deterministic from the committed seed, so it cannot be rerolled after bets close.
  if (value < 0.07) return 1;
  if (maxMultiplier <= 10) return 1.1 + Math.floor((value - 0.07) / 0.93 * 90) / 10;
  // Empty rounds use the classic heavy-tail crash distribution and may fly much farther.
  return Math.min(maxMultiplier, Math.max(1, Math.floor((0.97 / (1 - value)) * 100) / 100));
}

export function multiplierAt(startedAt, now) {
  return Math.min(MAX_MULTIPLIER, Math.floor((1 + Math.max(0, now - startedAt) / 10_000) * 10) / 10);
}

export function crashPayout(stake, multiplier) {
  if (!Number.isSafeInteger(stake) || stake < 100 || !Number.isFinite(multiplier) || multiplier < 1) {
    throw new Error('invalid_crash_payout');
  }
  return Math.floor(stake * Math.floor(multiplier * 100) / 100);
}

// Empty rounds are intentionally capped to a short, engaging 16x–20x flight.
// The value is deterministic from the server seed committed before the round starts.
export function makeEmptyRoundPoint(seed, roundId) {
  const value = Number(BigInt('0x' + sha256(seed + ':' + roundId + ':empty-flight').slice(0, 8))) / 0x1_0000_0000;
  if (value < 0.07) return 1;
  return 16 + Math.floor(((value - 0.07) / 0.93) * 41) / 10;
}
