import { createHash } from 'node:crypto';
const MAX_MULTIPLIER = 20;
const HASH_RANGE = 0x1_0000_0000;
function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }

// Fixed by the pre-committed server seed and round id, never by player activity.
export function makeCrashPoint(seed, roundId) {
  const value = Number(BigInt('0x' + sha256(seed + ':' + roundId).slice(0, 8))) / HASH_RANGE;
  if (value < 0.01) return 1.00;
  if (value < 0.80) return Number((1.1 + ((value - 0.01) / 0.79) * 1.8).toFixed(2));
  if (value < 0.98) return Number((3 + ((value - 0.80) / 0.18) * 6).toFixed(2));
  if (value < 0.998) return Number((10 + ((value - 0.98) / 0.018) * 2).toFixed(2));
  return Number((16 + ((value - 0.998) / 0.002) * 4).toFixed(2));
}
export function multiplierAt(startedAt, now) {
  return Math.min(MAX_MULTIPLIER, Math.floor((1 + Math.max(0, now - startedAt) / 10_000) * 10) / 10);
}
export function crashPayout(stake, multiplier) {
  if (!Number.isSafeInteger(stake) || stake < 100 || !Number.isFinite(multiplier) || multiplier < 1) throw new Error('invalid_crash_payout');
  return Math.floor(stake * Math.floor(multiplier * 100) / 100);
}
