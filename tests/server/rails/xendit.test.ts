import { describe, it, expect, vi, afterEach } from "vitest";
import { Decimal } from "@/lib/money";
import { createXenditProvider } from "@/server/rails/xendit";
import type { LiveRates } from "@/server/rates/live";

type Call = { url: string; init: RequestInit };

function fakeFetch(...responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch");
    return new Response(JSON.stringify(next.body), { status: next.status });
  });
  return { fetchImpl, calls };
}

const rates: LiveRates = {
  getRate: vi.fn(async () => ({ asset: "XLM" as const, rate: new Decimal("13.5"), source: "COINSPH" as const })),
};

const bank = { bankCode: "GCASH", accountName: "Juan Dela Cruz", accountNumber: "09171234567" };

afterEach(() => {
  delete process.env.HEYPAY_TREASURY_PUBLIC_KEY;
});

describe("Xendit rail", () => {
  it("creates a payout with the reference as idempotency key and the merchant's receipt email", async () => {
    const { fetchImpl, calls } = fakeFetch({
      status: 200,
      body: { id: "disb-123", status: "ACCEPTED", amount: 150.5 },
    });
    const rail = createXenditProvider({
      secretKey: "xnd_development_abc",
      fetchImpl,
      rates,
      receiptCc: "ops@heypay.test",
    });

    const res = await rail.createPayout({
      ref: "TXN-ABCD1234",
      phpAmount: new Decimal("150.50"),
      bank,
      receiptEmail: "shop@example.com",
    });

    expect(res.payoutRef).toBe("disb-123");
    const { url, init } = calls[0]!;
    expect(url).toBe("https://api.xendit.co/v2/payouts");
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-key"]).toBe("TXN-ABCD1234");
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("xnd_development_abc:").toString("base64")}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      reference_id: "TXN-ABCD1234",
      channel_code: "PH_GCASH",
      channel_properties: { account_number: "09171234567", account_holder_name: "Juan Dela Cruz" },
      amount: 150.5,
      currency: "PHP",
      description: "HeyPay payment TXN-ABCD1234",
      receipt_notification: { email_to: ["shop@example.com"], email_cc: ["ops@heypay.test"] },
    });
  });

  it("still sends HeyPay its receipt when the merchant has no payout email", async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 200, body: { id: "disb-1", status: "ACCEPTED" } });
    const rail = createXenditProvider({ secretKey: "k", fetchImpl, rates, receiptCc: "ops@heypay.test" });
    await rail.createPayout({ ref: "TXN-1", phpAmount: new Decimal("10"), bank, receiptEmail: null });
    expect(JSON.parse(calls[0]!.init.body as string).receipt_notification).toEqual({
      email_to: ["ops@heypay.test"],
    });
  });

  it("omits the receipt only when nobody at all would receive it", async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 200, body: { id: "disb-1", status: "ACCEPTED" } });
    const rail = createXenditProvider({ secretKey: "k", fetchImpl, rates, receiptCc: "" });
    await rail.createPayout({ ref: "TXN-1", phpAmount: new Decimal("10"), bank, receiptEmail: null });
    expect(JSON.parse(calls[0]!.init.body as string)).not.toHaveProperty("receipt_notification");
  });

  it("refuses a bank code Xendit cannot pay, without calling Xendit", async () => {
    const { fetchImpl } = fakeFetch();
    const rail = createXenditProvider({ secretKey: "k", fetchImpl, rates });
    await expect(
      rail.createPayout({
        ref: "TXN-1",
        phpAmount: new Decimal("10"),
        bank: { ...bank, bankCode: "NOTABANK" },
        receiptEmail: null,
      }),
    ).rejects.toThrow(/cannot pay out to bank code NOTABANK/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries a 5xx with the same idempotency key, but never a 4xx", async () => {
    const retrying = fakeFetch(
      { status: 503, body: {} },
      { status: 200, body: { id: "disb-9", status: "ACCEPTED" } },
    );
    const ok = createXenditProvider({ secretKey: "k", fetchImpl: retrying.fetchImpl, rates });
    const res = await ok.createPayout({ ref: "TXN-9", phpAmount: new Decimal("5"), bank, receiptEmail: null });
    expect(res.payoutRef).toBe("disb-9");
    expect(retrying.calls).toHaveLength(2);
    const keys = retrying.calls.map((c) => (c.init.headers as Record<string, string>)["Idempotency-key"]);
    expect(keys).toEqual(["TXN-9", "TXN-9"]);

    const rejecting = fakeFetch({ status: 400, body: { error_code: "API_VALIDATION_ERROR" } });
    const bad = createXenditProvider({ secretKey: "k", fetchImpl: rejecting.fetchImpl, rates });
    await expect(
      bad.createPayout({ ref: "TXN-8", phpAmount: new Decimal("5"), bank, receiptEmail: null }),
    ).rejects.toThrow(/rejected \(400\)/);
    expect(rejecting.calls).toHaveLength(1);
  });

  it.each([
    ["ACCEPTED", "PENDING"],
    ["REQUESTED", "PENDING"],
    ["SUCCEEDED", "SETTLED"],
    ["FAILED", "FAILED"],
    ["CANCELLED", "FAILED"],
    ["REVERSED", "FAILED"],
  ])("maps Xendit status %s to %s", async (xendit, expected) => {
    const { fetchImpl, calls } = fakeFetch({
      status: 200,
      body: { id: "disb-5", status: xendit, amount: 300, failure_code: "INVALID_DESTINATION" },
    });
    const rail = createXenditProvider({ secretKey: "k", fetchImpl, rates });
    const s = await rail.getPayoutStatus("disb-5");
    expect(calls[0]!.url).toBe("https://api.xendit.co/v2/payouts/disb-5");
    expect(s.state).toBe(expected);
    if (expected === "SETTLED") expect(s.netPhp?.toFixed(2)).toBe("300.00");
    if (xendit === "FAILED") expect(s.failureCode).toBe("INVALID_DESTINATION");
  });

  it("collects into the treasury and quotes off the live rate", async () => {
    process.env.HEYPAY_TREASURY_PUBLIC_KEY = "GTREASURY";
    const rail = createXenditProvider({ secretKey: "k", fetchImpl: fakeFetch().fetchImpl, rates });
    expect(await rail.getDepositAddress("XLM")).toEqual({ address: "GTREASURY", memo: null });

    const q = await rail.getQuote({ sell: "XLM", buy: "PHP", phpAmount: new Decimal("135") });
    expect(q.rate.toString()).toBe("13.5");
    expect(q.assetAmount.toFixed(7)).toBe("10.0000000");
    expect(q.source).toBe("COINSPH");
  });

  it("refuses to hand out a deposit address when no treasury is configured", async () => {
    const rail = createXenditProvider({ secretKey: "k", fetchImpl: fakeFetch().fetchImpl, rates });
    await expect(rail.getDepositAddress("XLM")).rejects.toThrow(/HEYPAY_TREASURY_PUBLIC_KEY/);
  });
});
