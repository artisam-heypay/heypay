// src/server/rails/provider.ts
import type { PaymentAsset } from "@/lib/assets";
import { Decimal } from "@/lib/money";

/** `rate` is 1 unit of the sell asset in PHP; `assetAmount` is what the payer must send. */
export type Quote = {
  asset: PaymentAsset;
  rate: Decimal;
  phpAmount: Decimal;
  assetAmount: Decimal;
  expiresAt: Date;
};
export type TradeResult = { tradeRef: string };
export type TradeStatus = {
  state: "PENDING" | "FILLED" | "FAILED";
  feePhp?: Decimal;
  filledPhp?: Decimal;
};
export type BankPayout = { bankCode: string; accountName: string; accountNumber: string };
export type PayoutResult = { payoutRef: string };
export type PayoutStatus = {
  state: "PENDING" | "SETTLED" | "FAILED";
  netPhp?: Decimal;
  feePhp?: Decimal;
};

export interface PaymentRailProvider {
  /**
   * Whether this rail can turn `asset` into PHP directly. A rail that can't
   * (no such trading pair) makes the asset unquotable rather than silently
   * settling it as something else.
   */
  supportsAsset(asset: PaymentAsset): boolean;
  getQuote(input: { sell: PaymentAsset; buy: "PHP"; phpAmount: Decimal }): Promise<Quote>;
  /** Sells `amount` of `asset` for PHP. Crypto must already be at the rail's deposit address. */
  sellCryptoForPhp(input: {
    ref: string;
    asset: PaymentAsset;
    amount: Decimal;
  }): Promise<TradeResult>;
  getTradeStatus(tradeRef: string): Promise<TradeStatus>;
  cashOutPhpToBank(input: {
    ref: string;
    phpAmount: Decimal;
    bank: BankPayout;
  }): Promise<PayoutResult>;
  getPayoutStatus(payoutRef: string): Promise<PayoutStatus>;
}

/**
 * The rail's deposit address for `asset` — where settlement sends the payer's
 * crypto before it is sold for PHP. Configured per asset because an exchange
 * hands out a distinct address (and sometimes a distinct network) per asset.
 */
export function railDepositAddress(asset: PaymentAsset): string | null {
  const value = process.env[`PDAX_${asset}_DEPOSIT_ADDRESS`]?.trim();
  return value ? value : null;
}

/**
 * Assets a rail is configured to trade, from `PDAX_SETTLEMENT_ASSETS`
 * (comma-separated). Unset means XLM only — the pair set v1 was built against.
 * PDAX's supported pairs are account-specific, so this stays configuration
 * rather than a hardcoded list.
 */
export function railSettlementAssets(env = process.env.PDAX_SETTLEMENT_ASSETS): PaymentAsset[] {
  if (!env) return ["XLM"];
  const parsed = env
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is PaymentAsset => s === "XLM" || s === "USDC" || s === "USDT");
  return parsed.length > 0 ? [...new Set(parsed)] : ["XLM"];
}
