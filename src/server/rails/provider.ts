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

/**
 * Where settlement sends the payer's crypto. `memo` is the rail's address tag:
 * exchanges share one address across customers and credit the deposit by memo,
 * so omitting it can lose the funds. Null memo means the rail didn't ask for one.
 */
export type CryptoDepositAddress = { address: string; memo: string | null };

export interface PaymentRailProvider {
  /**
   * Whether this rail can turn `asset` into PHP directly. A rail that can't
   * (no such trading pair) makes the asset unquotable rather than silently
   * settling it as something else.
   */
  supportsAsset(asset: PaymentAsset): boolean;
  /**
   * Smallest amount of `asset` the rail will sell, or null when it has no floor.
   * Exchanges enforce this in crypto units, so the equivalent PHP floor moves
   * with the rate.
   */
  minSellAmount(asset: PaymentAsset): Decimal | null;
  /** The rail's deposit address for `asset`, resolved at settlement time. */
  getDepositAddress(asset: PaymentAsset): Promise<CryptoDepositAddress>;
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
 * Statically configured deposit address for `asset`, if any. Takes precedence
 * over anything a rail resolves at runtime, so an operator can pin the address
 * the XLM leg has always used.
 */
export function railDepositAddress(asset: PaymentAsset): string | null {
  const value = process.env[`PDAX_${asset}_DEPOSIT_ADDRESS`]?.trim();
  return value ? value : null;
}

/**
 * PDAX names a crypto wallet by asset *and* network, e.g. `USDCXLM` is USDC on
 * Stellar (as opposed to USDC on another chain). Native XLM is just `XLM`.
 */
export function pdaxCryptoCurrency(asset: PaymentAsset): string {
  return asset === "XLM" ? "XLM" : `${asset}XLM`;
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
