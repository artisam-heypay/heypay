import { describe, it, expect } from "vitest";
import { Decimal } from "@/lib/money";
import { createMockProvider } from "@/server/rails/mock";

const make = () => createMockProvider({ rate: new Decimal("3.50"), delayMs: 0 });

describe("MockProvider.getQuote", () => {
  it("computes assetAmount via phpToAsset with ROUND_UP at 7dp and a ~90s expiry", async () => {
    const p = make();
    const before = Date.now();
    const q = await p.getQuote({ sell: "XLM", buy: "PHP", phpAmount: new Decimal("100.00") });
    expect(q.rate.toString()).toBe("3.5");
    expect(q.phpAmount.toString()).toBe("100");
    // 100 / 3.5 = 28.571428571... -> ROUND_UP at 7dp
    expect(q.assetAmount.toFixed(7)).toBe("28.5714286");
    expect(q.source).toBe("MOCK");
    const ms = q.expiresAt.getTime() - before;
    expect(ms).toBeGreaterThanOrEqual(89_000);
    expect(ms).toBeLessThanOrEqual(91_000);
  });

  it("quotes USDT off its own rate, not the XLM one", async () => {
    const p = createMockProvider({
      rate: new Decimal("3.50"),
      rates: { USDT: new Decimal("58.00") },
      delayMs: 0,
    });
    const q = await p.getQuote({ sell: "USDT", buy: "PHP", phpAmount: new Decimal("100.00") });
    expect(q.asset).toBe("USDT");
    expect(q.rate.toString()).toBe("58");
    // 100 / 58 = 1.7241379310... -> ROUND_UP at 7dp
    expect(q.assetAmount.toFixed(7)).toBe("1.7241380");
  });
});

describe("MockProvider payout lifecycle", () => {
  it("transitions PENDING -> SETTLED with netPhp equal to the cash-out amount", async () => {
    const p = make();
    const r = await p.createPayout({
      ref: "TXN-OK",
      phpAmount: new Decimal("99.00"),
      bank: { bankCode: "BDO", accountName: "Jane", accountNumber: "1234567890" },
      receiptEmail: "shop@example.com",
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
    const r = await p.createPayout({
      ref: "TXN-FAIL-2",
      phpAmount: new Decimal("99.00"),
      bank: { bankCode: "BDO", accountName: "Jane", accountNumber: "1234567890" },
      receiptEmail: null,
    });
    const s = await p.getPayoutStatus(r.payoutRef);
    expect(s.state).toBe("FAILED");
  });

  it("is idempotent per reference, like Xendit's idempotency key", async () => {
    const p = make();
    const input = {
      ref: "TXN-TWICE",
      phpAmount: new Decimal("50.00"),
      bank: { bankCode: "GCASH", accountName: "Jane", accountNumber: "09171234567" },
      receiptEmail: null,
    };
    const a = await p.createPayout(input);
    await p.getPayoutStatus(a.payoutRef); // PENDING, polls = 1
    const b = await p.createPayout(input); // must not reset the payout
    expect(b.payoutRef).toBe(a.payoutRef);
    expect((await p.getPayoutStatus(b.payoutRef)).state).toBe("SETTLED");
  });
});
