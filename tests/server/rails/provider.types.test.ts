import { describe, it, expect, expectTypeOf } from "vitest";
import { Decimal } from "@/lib/money";
import type {
  Quote,
  BankPayout,
  PayoutResult,
  PayoutStatus,
  PaymentRailProvider,
} from "@/server/rails/provider";

describe("provider contract", () => {
  it("Quote carries Decimal amounts, a Date expiry and its rate source", () => {
    const q: Quote = {
      asset: "XLM",
      rate: new Decimal("3.50"),
      phpAmount: new Decimal("100.00"),
      assetAmount: new Decimal("28.5714286"),
      expiresAt: new Date("2026-06-28T00:00:00.000Z"),
      source: "COINSPH",
    };
    expect(q.rate).toBeInstanceOf(Decimal);
    expect(q.expiresAt).toBeInstanceOf(Date);
  });

  it("PayoutStatus.state is the locked union", () => {
    const s: PayoutStatus = { state: "SETTLED", netPhp: new Decimal("99.00") };
    expectTypeOf(s.state).toEqualTypeOf<"PENDING" | "SETTLED" | "FAILED">();
  });

  it("PaymentRailProvider has exactly the five methods of a collect-then-pay-out rail", () => {
    expectTypeOf<keyof PaymentRailProvider>().toEqualTypeOf<
      "supportsAsset" | "getDepositAddress" | "getQuote" | "createPayout" | "getPayoutStatus"
    >();
    // structural use of the remaining types so unused-import lint stays clean
    const p: PayoutResult = { payoutRef: "y" };
    const b: BankPayout = { bankCode: "BDO", accountName: "A", accountNumber: "1" };
    expect([p.payoutRef, b.bankCode]).toHaveLength(2);
  });
});
