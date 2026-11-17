export type ArenaSettlementEntry = {
  telegramId?: string;
  telegram_id?: string;
  amount: number;
  purchasedAmount?: number;
  purchased_amount?: number;
  walletAmount?: number;
  wallet_amount?: number;
};
export type ArenaSettlement = {
  total: number;
  fee: number;
  opponentPool: number;
  netWinnings: number;
  winnerRefund: null | { telegramId: string; purchasedAmount: number; walletAmount: number; amount: number };
  refunds: Array<{ telegramId: string; purchasedAmount: number; walletAmount: number; amount: number }>;
};
export function calculateArenaSettlement(entries: ArenaSettlementEntry[], winnerType: string, winnerTelegramId: string | null, cancelled?: boolean): ArenaSettlement;
