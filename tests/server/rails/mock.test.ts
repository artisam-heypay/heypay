import { describe, it, expect } from "vitest";
import { Decimal } from "@/lib/money";
import { createMockProvider } from "@/server/rails/mock";

const make = () =>
  createMockProvider({ rate: new Decimal("3.50"), delayMs: 0, feeRate: new Decimal("0.01") });

describe("MockProvider.getQuote", () => {
  it("computes xlmAmount via phpToXlm with ROUND_UP at 7dp and a ~90s expiry", async () => {
    const p = make();
    const before = Date.now();
    const q = await p.getQuote({ sell: "XLM", buy: "PHP", phpAmount: new Decimal("100.00") });
    expect(q.rate.toString()).toBe("3.5");
    expect(q.phpAmount.toString()).toBe("100");
    // 100 / 3.5 = 28.571428571... -> ROUND_UP at 7dp
    expect(q.xlmAmount.toFixed(7)).toBe("28.5714286");
    const ms = q.expiresAt.getTime() - before;
    expect(ms).toBeGreaterThanOrEqual(89_000);
    expect(ms).toBeLessThanOrEqual(91_000);
  });
});

describe("MockProvider trade lifecycle", () => {
  it("returns a deterministic tradeRef derived from the input ref", async () => {
    const p = make();
    const r = await p.sellCryptoForPhp({ ref: "TXN-ABC123", xlmAmount: new Decimal("28.5714286") });
    expect(r.tradeRef).toBe("MOCK-TRADE-TXN-ABC123");
  });

  it("transitions PENDING -> FILLED with feePhp on PHP", async () => {
    const p = make();
    const r = await p.sellCryptoForPhp({ ref: "TXN-OK", xlmAmount: new Decimal("28.5714286") });
    const first = await p.getTradeStatus(r.tradeRef);
    expect(first.state).toBe("PENDING");
    const second = await p.getTradeStatus(r.tradeRef);
    expect(second.state).toBe("FILLED");
    // 28.5714286 * 3.5 = 100.0000001 -> 2dp = 100.00
    expect(second.filledPhp?.toFixed(2)).toBe("100.00");
    // fee = 100.00 * 0.01 = 1.00
    expect(second.feePhp?.toFixed(2)).toBe("1.00");
  });

  it("forced-failure: ref containing FAIL yields FAILED trade", async () => {
    const p = make();
    const r = await p.sellCryptoForPhp({ ref: "TXN-FAIL-1", xlmAmount: new Decimal("10") });
    expect(r.tradeRef).toBe("MOCK-TRADE-TXN-FAIL-1");
    const s = await p.getTradeStatus(r.tradeRef);
    expect(s.state).toBe("FAILED");
  });
});

describe("MockProvider payout lifecycle", () => {
  it("transitions PENDING -> SETTLED with netPhp equal to the cash-out amount", async () => {
    const p = make();
    const r = await p.cashOutPhpToBank({
      ref: "TXN-OK",
      phpAmount: new Decimal("99.00"),
      bank: { bankCode: "BDO", accountName: "Jane", accountNumber: "1234567890" },
    });
    expect(r.payoutRef).toBe("MOCK-PAYOUT-TXN-OK");
    const first = await p.getPayoutStatus(r.payoutRef);
    expect(first.state).toBe("PENDING");
    const second = await p.getPayoutStatus(r.payoutRef);
    expect(second.state).toBe("SETTLED");
    expect(second.netPhp?.toFixed(2)).toBe("99.00");
  });

  it("forced-failure: ref containing FAIL yields FAILED payout", async () => {
    const p = make();
    const r = await p.cashOutPhpToBank({
      ref: "TXN-FAIL-2",
      phpAmount: new Decimal("99.00"),
      bank: { bankCode: "BDO", accountName: "Jane", accountNumber: "1234567890" },
    });
    const s = await p.getPayoutStatus(r.payoutRef);
    expect(s.state).toBe("FAILED");
  });
});
