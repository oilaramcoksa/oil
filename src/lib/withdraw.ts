// Withdrawal rules shared by the client and the API.
//
// Rate: every 100,000 game coins = 1 USD, paid out in TON.
// There is NO upfront fee: nothing is ever requested from the player to
// "unlock" a withdrawal. Requests are reviewed manually and marked as
// paid (with the TON transaction hash) or rejected (coins are refunded).

export const COINS_PER_USD = 100_000;
export const MIN_UNITS = 1;          // minimum = 1 USD = 100,000 coins
export const MAX_UNITS_PER_REQUEST = 1000;

export type WithdrawalStatus = 'pending' | 'paid' | 'rejected';

export interface WithdrawalRecord {
  id: string;
  units: number;            // = USD amount
  coins: number;            // coins locked for this request
  usd: number;
  tonAddress: string;
  status: WithdrawalStatus;
  txHash?: string | null;
  adminNote?: string | null;
  createdAt: number;
  updatedAt: number;
}

export function unitsToCoins(units: number): number {
  return units * COINS_PER_USD;
}

export function maxUnits(coins: number): number {
  return Math.min(MAX_UNITS_PER_REQUEST, Math.floor(coins / COINS_PER_USD));
}

// ---- TON address validation ------------------------------------------------

function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function decodeBase64Url(s: string): Uint8Array | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * Accepts a TON address in user-friendly form (EQ…/UQ…, 48 chars, with CRC
 * check) or raw form (0:<64 hex>). Testnet-only addresses are rejected.
 */
export function isValidTonAddress(input: string): boolean {
  const addr = input.trim();
  if (/^-?[01]:[0-9a-fA-F]{64}$/.test(addr)) return true;
  if (!/^[A-Za-z0-9_-]{48}$/.test(addr)) return false;
  const bytes = decodeBase64Url(addr);
  if (!bytes || bytes.length !== 36) return false;
  const tag = bytes[0];
  // 0x11 bounceable, 0x51 non-bounceable (mainnet). 0x80 bit = testnet-only.
  if (tag !== 0x11 && tag !== 0x51) return false;
  const expected = (bytes[34] << 8) | bytes[35];
  return crc16(bytes.slice(0, 34)) === expected;
}
