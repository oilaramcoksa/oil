import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateArenaSettlement } from '../src/lib/arena-settlement.mjs';

test('winner gets original purchased stake back and 90% of opponent stake as winnings', () => {
  const result = calculateArenaSettlement([
    { telegramId: 'mohamed', amount: 3000, purchasedAmount: 3000, walletAmount: 0 },
    { telegramId: 'ahmed', amount: 3000, purchasedAmount: 3000, walletAmount: 0 },
  ], 'player', 'ahmed');
  assert.deepEqual(result.winnerRefund, { telegramId: 'ahmed', purchasedAmount: 3000, walletAmount: 0, amount: 3000 });
  assert.equal(result.opponentPool, 3000);
  assert.equal(result.fee, 300);
  assert.equal(result.netWinnings, 2700);
});

test('winner stake split across purchased and regular wallet is restored to the same sources', () => {
  const result = calculateArenaSettlement([
    { telegramId: 'winner', amount: 5000, purchasedAmount: 3000, walletAmount: 2000 },
    { telegramId: 'loser', amount: 5000, purchasedAmount: 1000, walletAmount: 4000 },
  ], 'player', 'winner');
  assert.deepEqual(result.winnerRefund, { telegramId: 'winner', purchasedAmount: 3000, walletAmount: 2000, amount: 5000 });
  assert.equal(result.netWinnings, 4500);
  assert.equal(result.fee, 500);
});

test('losing player receives no stake refund or winnings', () => {
  const result = calculateArenaSettlement([
    { telegramId: 'winner', amount: 3000, purchasedAmount: 3000, walletAmount: 0 },
    { telegramId: 'loser', amount: 3000, purchasedAmount: 1000, walletAmount: 2000 },
  ], 'player', 'winner');
  assert.equal(result.refunds.length, 0);
  assert.equal(result.winnerRefund.telegramId, 'winner');
  assert.equal(result.netWinnings, 2700);
});

test('cancelled round refunds every entry to its original source and charges no fee', () => {
  const result = calculateArenaSettlement([
    { telegramId: 'a', amount: 3000, purchasedAmount: 2000, walletAmount: 1000 },
    { telegramId: 'b', amount: 4000, purchasedAmount: 0, walletAmount: 4000 },
  ], null, null, true);
  assert.deepEqual(result.refunds, [
    { telegramId: 'a', purchasedAmount: 2000, walletAmount: 1000, amount: 3000 },
    { telegramId: 'b', purchasedAmount: 0, walletAmount: 4000, amount: 4000 },
  ]);
  assert.equal(result.fee, 0);
  assert.equal(result.netWinnings, 0);
});

test('legacy entries without source columns default to regular wallet', () => {
  const result = calculateArenaSettlement([{ telegramId: 'old', amount: 700 }], null, null, true);
  assert.deepEqual(result.refunds[0], { telegramId: 'old', purchasedAmount: 0, walletAmount: 700, amount: 700 });
});
