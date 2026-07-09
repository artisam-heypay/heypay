// src/server/rails/mock.ts
import "server-only";
import { Decimal, dec, phpToXlm } from "@/lib/money";
import type {
  BankPayout,
  PaymentRailProvider,
  PayoutResult,
  PayoutStatus,
  Quote,
  TradeResult,
  TradeStatus,
} from "@/server/rails/provider";

const QUOTE_TTL_MS = 90_000;

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
const isForcedFailure = (ref: string): boolean => ref.includes("FAIL");

// Optional deterministic failure trigger for e2e/demo: a magic PHP amount forces the
// settlement to fail (and thus exercise the refund branch). Unset in prod.
const failPhpAmount = process.env.MOCK_FAIL_PHP_AMOUNT
  ? dec(process.env.MOCK_FAIL_PHP_AMOUNT)
  : null;
const isFailAmount = (phpAmount: Decimal): boolean =>
  failPhpAmount !== null && phpAmount.equals(failPhpAmount);

type TradeRecord = { ref: string; xlmAmount: Decimal; polls: number };
type PayoutRecord = { ref: string; phpAmount: Decimal; polls: number };

export function createMockProvider(
  cfg: { rate?: Decimal; delayMs?: number; feeRate?: Decimal } = {},
): PaymentRailProvider {
  const rate = cfg.rate ?? dec(process.env.MOCK_XLM_PHP_RATE ?? "3.50");
  const delayMs = cfg.delayMs ?? Number(process.env.MOCK_RAIL_DELAY_MS ?? "0");
  const feeRate = cfg.feeRate ?? dec(process.env.MOCK_RAIL_FEE_RATE ?? "0.01");

  const trades = new Map<string, TradeRecord>();
  const payouts = new Map<string, PayoutRecord>();

  return {
    async getQuote({ phpAmount }): Promise<Quote> {
      await sleep(delayMs);
      return {
        rate,
        phpAmount,
        xlmAmount: phpToXlm(phpAmount, rate),
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
      };
    },

    async sellCryptoForPhp({ ref, xlmAmount }): Promise<TradeResult> {
      await sleep(delayMs);
      const tradeRef = `MOCK-TRADE-${ref}`;
      trades.set(tradeRef, { ref, xlmAmount, polls: 0 });
      return { tradeRef };
    },

    async getTradeStatus(tradeRef): Promise<TradeStatus> {
      await sleep(delayMs);
      const rec = trades.get(tradeRef);
      if (!rec) return { state: "FAILED" };
      if (isForcedFailure(rec.ref)) return { state: "FAILED" };
      rec.polls += 1;
      if (rec.polls < 2) return { state: "PENDING" };
      const filledPhp = rec.xlmAmount.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const feePhp = filledPhp.times(feeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      return { state: "FILLED", filledPhp, feePhp };
    },

    async cashOutPhpToBank({
      ref,
      phpAmount,
    }: {
      ref: string;
      phpAmount: Decimal;
      bank: BankPayout;
    }): Promise<PayoutResult> {
      await sleep(delayMs);
      const payoutRef = `MOCK-PAYOUT-${ref}`;
      payouts.set(payoutRef, { ref, phpAmount, polls: 0 });
      return { payoutRef };
    },

    async getPayoutStatus(payoutRef): Promise<PayoutStatus> {
      await sleep(delayMs);
      const rec = payouts.get(payoutRef);
      if (!rec) return { state: "FAILED" };
      if (isForcedFailure(rec.ref) || isFailAmount(rec.phpAmount)) return { state: "FAILED" };
      rec.polls += 1;
      if (rec.polls < 2) return { state: "PENDING" };
      return { state: "SETTLED", netPhp: rec.phpAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP) };
    },
  };
}

export const mockProvider: PaymentRailProvider = createMockProvider();
