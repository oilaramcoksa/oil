import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCrashPoint, multiplierAt, crashPayout } from '../src/lib/crash-game.mjs';
test('crash point is deterministic for a committed round seed', () => {
  assert.equal(makeCrashPoint('sample-seed','round-1'),makeCrashPoint('sample-seed','round-1'));
  assert.ok(makeCrashPoint('sample-seed','round-1') >= 1 && makeCrashPoint('sample-seed','round-1') <= 20);
});
test('different round ids derive different outcomes', () => assert.notEqual(makeCrashPoint('sample-seed','round-1'),makeCrashPoint('sample-seed','round-2')));
test('multiplier increases by 0.10x per second', () => {
  assert.equal(multiplierAt(10_000,10_000),1); assert.equal(multiplierAt(10_000,11_000),1.1);
  assert.equal(multiplierAt(10_000,12_000),1.2); assert.equal(multiplierAt(10_000,22_000),2.2);
});
test('multiplier is capped at 20x', () => assert.equal(multiplierAt(0,10_000_000),20));
test('cashout returns stake multiplied by accepted multiplier', () => {
  assert.equal(crashPayout(1000,2.5),2500); assert.equal(crashPayout(999,1.37),1368);
});
test('invalid payouts are rejected', () => {
  assert.throws(() => crashPayout(99,2),/invalid_crash_payout/); assert.throws(() => crashPayout(100,.9),/invalid_crash_payout/);
});
test('10,000 deterministic outcomes follow the configured bands', () => {
  const counts={early:0,middle:0,rare:0,veryRare:0,instant:0};
  for(let i=0;i<10000;i++){
    const point=makeCrashPoint('distribution-seed-'+i,'round-'+i); assert.ok(point>=1&&point<=20);
    if(point===1) counts.instant++; else if(point<=2.9) counts.early++; else if(point<=9) counts.middle++; else if(point<=12) counts.rare++; else counts.veryRare++;
  }
  assert.ok(counts.early>7500&&counts.early<8200); assert.ok(counts.middle>1600&&counts.middle<2000);
  assert.ok(counts.rare>120&&counts.rare<250); assert.ok(counts.veryRare>5&&counts.veryRare<40); assert.ok(counts.instant>50&&counts.instant<150);
});
