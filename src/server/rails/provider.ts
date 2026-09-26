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
  /** Where the rate came from, e.g. COINSPH, CMC or MOCK; recorded with the quote. */
  source: string;
};
export type BankPayout = { bankCode: string; accountName: string; accountNumber: string };
export type PayoutResult = { payoutRef: string };
export type PayoutStatus = {
  state: "PENDING" | "SETTLED" | "FAILED";
  netPhp?: Decimal;
  feePhp?: Decimal;
  /** The rail's reason when `state` is FAILED, e.g. Xendit's `failure_code`. */
  failureCode?: string;
};

/**
 * Where settlement sends the payer's crypto. `memo` is an address tag the
 * receiver needs to credit the deposit; null means none is required and the
 * payment's own reference is used.
 */
export type CryptoDepositAddress = { address: string; memo: string | null };

/**
 * A settlement rail: HeyPay collects the payer's crypto at `getDepositAddress`
 * and pays the merchant PHP with `createPayout`. The two legs are independent —
 * the rail never trades the crypto, so the merchant is paid from HeyPay's own
 * PHP balance at the rail.
 */
export interface PaymentRailProvider {
  /** Whether a payer may fund a payment with `asset` on this rail. */
  supportsAsset(asset: PaymentAsset): boolean;
  /** Where the payer's `asset` is sent, resolved at settlement time. */
  getDepositAddress(asset: PaymentAsset): Promise<CryptoDepositAddress>;
  getQuote(input: { sell: PaymentAsset; buy: "PHP"; phpAmount: Decimal }): Promise<Quote>;
  /**
   * Pays `phpAmount` into the merchant's bank or e-wallet. `ref` is the
   * payment reference and doubles as the idempotency key, so a retried call
   * never pays twice. `receiptEmail` receives the rail's payout receipt.
   */
  createPayout(input: {
    ref: string;
    phpAmount: Decimal;
    bank: BankPayout;
    receiptEmail: string | null;
  }): Promise<PayoutResult>;
  getPayoutStatus(payoutRef: string): Promise<PayoutStatus>;
}

/**
 * The HeyPay treasury: the Stellar account every payer's crypto is sent to.
 * Null when unset, so callers can refuse rather than pay to nowhere.
 */
export function treasuryAddress(): string | null {
  const value = process.env.HEYPAY_TREASURY_PUBLIC_KEY?.trim();
  return value ? value : null;
}
