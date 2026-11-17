export function calculateArenaSettlement(entries, winnerType, winnerTelegramId, cancelled = false) {
  const normalized = entries.map((entry) => {
    const amount = Number(entry.amount);
    let purchasedAmount = Number(entry.purchasedAmount ?? entry.purchased_amount ?? 0);
    let walletAmount = Number(entry.walletAmount ?? entry.wallet_amount ?? 0);
    // Entries created before source tracking was deployed are treated as regular-wallet stakes.
    if (purchasedAmount === 0 && walletAmount === 0 && amount > 0) walletAmount = amount;
    if (!Number.isSafeInteger(amount) || amount < 0 ||
        !Number.isSafeInteger(purchasedAmount) || purchasedAmount < 0 ||
        !Number.isSafeInteger(walletAmount) || walletAmount < 0 ||
        purchasedAmount + walletAmount !== amount) {
      throw new Error('invalid_arena_entry_amount_sources');
    }
    return { ...entry, amount, purchasedAmount, walletAmount };
  });
  const total = normalized.reduce((sum, entry) => sum + entry.amount, 0);
  if (cancelled) {
    return {
      total, fee: 0, opponentPool: 0, netWinnings: 0,
      winnerRefund: null,
      refunds: normalized.map((entry) => ({
        telegramId: String(entry.telegramId ?? entry.telegram_id),
        purchasedAmount: entry.purchasedAmount,
        walletAmount: entry.walletAmount,
        amount: entry.amount,
      })),
    };
  }
  const winner = winnerType === 'player'
    ? normalized.find((entry) => String(entry.telegramId ?? entry.telegram_id) === String(winnerTelegramId))
    : undefined;
  if (winnerType === 'player' && !winner) throw new Error('arena_winner_entry_missing');
  const opponentPool = winner ? total - winner.amount : 0;
  const fee = winner ? Math.floor(opponentPool * 0.10) : 0;
  return {
    total, fee, opponentPool, netWinnings: opponentPool - fee,
    winnerRefund: winner ? {
      telegramId: String(winner.telegramId ?? winner.telegram_id),
      purchasedAmount: winner.purchasedAmount,
      walletAmount: winner.walletAmount,
      amount: winner.amount,
    } : null,
    refunds: [],
  };
}
