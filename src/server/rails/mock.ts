// src/server/rails/mock.ts
import "server-only";
import { Decimal, dec, phpToAsset } from "@/lib/money";
import type { PaymentAsset } from "@/lib/assets";
import { badRequest } from "@/lib/errors";
import {
  treasuryAddress,
  type PaymentRailProvider,
  type PayoutResult,
  type PayoutStatus,
  type Quote,
} from "@/server/rails/provider";

const QUOTE_TTL_MS = 90_000;

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
const isForcedFailure = (ref: string): boolean => ref.includes("FAIL");

// Optional deterministic failure trigger for e2e/demo: a magic PHP amount forces the
// payout to fail (and thus exercise the refund branch). Unset in prod.
const failPhpAmount = process.env.MOCK_FAIL_PHP_AMOUNT
  ? dec(process.env.MOCK_FAIL_PHP_AMOUNT)
  : null;
const isFailAmount = (phpAmount: Decimal): boolean =>
  failPhpAmount !== null && phpAmount.equals(failPhpAmount);

type PayoutRecord = { ref: string; phpAmount: Decimal; polls: number };

/** Deterministic per-asset PHP rates so dev/CI can exercise every enabled asset. */
function defaultRates(): Record<PaymentAsset, Decimal> {
  return {
    XLM: dec(process.env.MOCK_XLM_PHP_RATE ?? "3.50"),
    USDT: dec(process.env.MOCK_USDT_PHP_RATE ?? "58.00"),
    USDC: dec(process.env.MOCK_USDC_PHP_RATE ?? "58.00"),
  };
}

export function createMockProvider(
  cfg: {
    rate?: Decimal;
    rates?: Partial<Record<PaymentAsset, Decimal>>;
    delayMs?: number;
  } = {},
): PaymentRailProvider {
  // `rate` (legacy, XLM-only) still overrides the XLM leg so existing callers work.
  const rates: Record<PaymentAsset, Decimal> = {
    ...defaultRates(),
    ...(cfg.rate ? { XLM: cfg.rate } : {}),
    ...cfg.rates,
  };
  const delayMs = cfg.delayMs ?? Number(process.env.MOCK_RAIL_DELAY_MS ?? "0");
  const payouts = new Map<string, PayoutRecord>();

  const rateFor = (asset: PaymentAsset): Decimal => {
    const r = rates[asset];
    if (!r) throw badRequest(`mock rail has no ${asset}PHP rate`);
    return r;
  };

  return {
    supportsAsset: () => true,

    getDepositAddress(asset) {
      // Dev/CI: the configured treasury if there is one, else a stand-in that
      // never gets submitted to a network.
      const address = treasuryAddress() ?? `GMOCK${asset}DEPOSITADDRESS`;
      return Promise.resolve({ address, memo: null });
    },

    async getQuote({ sell, phpAmount }): Promise<Quote> {
      await sleep(delayMs);
      const rate = rateFor(sell);
      return {
        asset: sell,
        rate,
        phpAmount,
        assetAmount: phpToAsset(phpAmount, rate),
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
        source: "MOCK",
      };
    },

    async createPayout({ ref, phpAmount }): Promise<PayoutResult> {
      await sleep(delayMs);
      const payoutRef = `MOCK-PAYOUT-${ref}`;
      if (!payouts.has(payoutRef)) payouts.set(payoutRef, { ref, phpAmount, polls: 0 });
      return { payoutRef };
    },

    async getPayoutStatus(payoutRef): Promise<PayoutStatus> {
      await sleep(delayMs);
      const rec = payouts.get(payoutRef);
      if (!rec) return { state: "FAILED", failureCode: "NOT_FOUND" };
      if (isForcedFailure(rec.ref) || isFailAmount(rec.phpAmount)) {
        return { state: "FAILED", failureCode: "MOCK_FAILURE" };
      }
      rec.polls += 1;
      if (rec.polls < 2) return { state: "PENDING" };
      return { state: "SETTLED", netPhp: rec.phpAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP) };
    },
  };
}

export const mockProvider: PaymentRailProvider = createMockProvider();
