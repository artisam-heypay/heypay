// src/server/rails/provider.ts
import { Decimal } from "@/lib/money";

export type Quote = { rate: Decimal; phpAmount: Decimal; xlmAmount: Decimal; expiresAt: Date };
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
  getQuote(input: { sell: "XLM"; buy: "PHP"; phpAmount: Decimal }): Promise<Quote>;
  sellCryptoForPhp(input: { ref: string; xlmAmount: Decimal }): Promise<TradeResult>;
  getTradeStatus(tradeRef: string): Promise<TradeStatus>;
  cashOutPhpToBank(input: {
    ref: string;
    phpAmount: Decimal;
    bank: BankPayout;
  }): Promise<PayoutResult>;
  getPayoutStatus(payoutRef: string): Promise<PayoutStatus>;
}
