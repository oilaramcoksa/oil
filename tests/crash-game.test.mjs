import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCrashPoint, multiplierAt, crashPayout } from '../src/lib/crash-game.mjs';

test('crash point is deterministic for a committed round seed', () => {
  const a = makeCrashPoint('sample-seed', 'round-1');
  const b = makeCrashPoint('sample-seed', 'round-1');
  assert.equal(a, b);
  assert.ok(a >= 1 && a <= 1000);
});

test('different round ids produce independently derived crash points', () => {
  assert.notEqual(makeCrashPoint('sample-seed', 'round-1'), makeCrashPoint('sample-seed', 'round-2'));
});

test('multiplier starts at 1.00x and grows exponentially with server time', () => {
  assert.equal(multiplierAt(10_000, 10_000), 1);
  assert.ok(multiplierAt(10_000, 22_000) > 2.7);
  assert.ok(multiplierAt(10_000, 22_000) < 2.8);
});

test('multiplier is capped at the published game maximum', () => {
  assert.equal(multiplierAt(0, 1_000_000), 1000);
});

test('cashout returns the stake multiplied by the accepted multiplier', () => {
  assert.equal(crashPayout(1000, 2.5), 2500);
  assert.equal(crashPayout(999, 1.37), 1368);
});

test('invalid Crash payouts are rejected', () => {
  assert.throws(() => crashPayout(99, 2), /invalid_crash_payout/);
  assert.throws(() => crashPayout(100, 0.9), /invalid_crash_payout/);
});
