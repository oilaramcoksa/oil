import { createHash } from 'node:crypto';

const MAX_MULTIPLIER = 1000;

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function makeCrashPoint(seed, roundId, maxMultiplier = MAX_MULTIPLIER) {
  const value = Number(BigInt('0x' + sha256(seed + ':' + roundId).slice(0, 8))) / 0x1_0000_0000;
  return Math.min(maxMultiplier, Math.max(1, Math.floor((0.97 / (1 - value)) * 100) / 100));
}

export function multiplierAt(startedAt, now) {
  return Math.min(MAX_MULTIPLIER, Math.floor(Math.exp(Math.max(0, now - startedAt) / 12_000) * 100) / 100);
}

export function crashPayout(stake, multiplier) {
  if (!Number.isSafeInteger(stake) || stake < 100 || !Number.isFinite(multiplier) || multiplier < 1) {
    throw new Error('invalid_crash_payout');
  }
  return Math.floor(stake * Math.floor(multiplier * 100) / 100);
}
