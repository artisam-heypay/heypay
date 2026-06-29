import { describe, it, expect, expectTypeOf } from "vitest";
import { Decimal } from "@/lib/money";
import type {
  Quote,
  TradeResult,
  TradeStatus,
  BankPayout,
  PayoutResult,
  PayoutStatus,
  PaymentRailProvider,
} from "@/server/rails/provider";

describe("provider contract", () => {
  it("Quote carries Decimal amounts + Date expiry", () => {
    const q: Quote = {
      rate: new Decimal("3.50"),
      phpAmount: new Decimal("100.00"),
      xlmAmount: new Decimal("28.5714286"),
      expiresAt: new Date("2026-06-28T00:00:00.000Z"),
    };
    expect(q.rate).toBeInstanceOf(Decimal);
    expect(q.expiresAt).toBeInstanceOf(Date);
  });

  it("TradeStatus.state is the locked union", () => {
    const s: TradeStatus = {
      state: "FILLED",
      feePhp: new Decimal("1.00"),
      filledPhp: new Decimal("99.00"),
    };
    expectTypeOf(s.state).toEqualTypeOf<"PENDING" | "FILLED" | "FAILED">();
  });

  it("PayoutStatus.state is the locked union", () => {
    const s: PayoutStatus = { state: "SETTLED", netPhp: new Decimal("99.00") };
    expectTypeOf(s.state).toEqualTypeOf<"PENDING" | "SETTLED" | "FAILED">();
  });

  it("PaymentRailProvider has exactly the five locked methods", () => {
    expectTypeOf<keyof PaymentRailProvider>().toEqualTypeOf<
      "getQuote" | "sellCryptoForPhp" | "getTradeStatus" | "cashOutPhpToBank" | "getPayoutStatus"
    >();
    // structural use of the remaining types so unused-import lint stays clean
    const r: TradeResult = { tradeRef: "x" };
    const p: PayoutResult = { payoutRef: "y" };
    const b: BankPayout = { bankCode: "BDO", accountName: "A", accountNumber: "1" };
    const q: Quote = {
      rate: new Decimal(1),
      phpAmount: new Decimal(1),
      xlmAmount: new Decimal(1),
      expiresAt: new Date(),
    };
    expect([r.tradeRef, p.payoutRef, b.bankCode, q.rate.toString()]).toHaveLength(4);
  });
});
