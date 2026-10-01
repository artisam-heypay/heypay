import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { Decimal } from "@/lib/money";
import { signRequest, generateTotp, createPdaxProvider } from "@/server/rails/pdax";

const baseCfg = {
  baseUrl: "https://services-stage.pdax.ph/api/exchange/v1",
  accessKey: "AK_TEST",
  secret: "SECRET_TEST",
  totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", // base32 of "12345678901234567890"
  now: () => 1_700_000_000_000,
  retries: 3,
  baseMs: 0,
  timeoutMs: 1000,
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("signRequest (HMAC vector)", () => {
  it("produces Access-Key + HMAC-SHA256 Access-Signature over timestamp+method+path+body", () => {
    const input = {
      method: "POST",
      path: "/trades",
      body: '{"traded_currency":"XLM"}',
      timestamp: "1700000000000",
      accessKey: "AK_TEST",
      secret: "SECRET_TEST",
    };
    const expected = createHmac("sha256", "SECRET_TEST")
      .update("1700000000000" + "POST" + "/trades" + '{"traded_currency":"XLM"}')
      .digest("hex");
    const headers = signRequest(input);
    expect(headers["Access-Key"]).toBe("AK_TEST");
    expect(headers["Access-Signature"]).toBe(expected);
  });
});

describe("generateTotp (RFC 6238 SHA-1 vector)", () => {
  it("matches the RFC 6238 test vector at T=59s", () => {
    // secret "12345678901234567890", time 59s, step 30 -> 6-digit code "287082"
    expect(generateTotp(baseCfg.totpSecret, { timestamp: 59_000, digits: 6, period: 30 })).toBe(
      "287082",
    );
  });
});

describe("PdaxProvider method mapping", () => {
  it("getQuote maps price into a Decimal rate and computes assetAmount", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ traded_currency: "XLM", settlement_currency: "PHP", price: "3.50" }),
    );
    const p = createPdaxProvider({ ...baseCfg, fetchImpl });
    const q = await p.getQuote({ sell: "XLM", buy: "PHP", phpAmount: new Decimal("100.00") });
    expect(q.rate.toString()).toBe("3.5");
    expect(q.assetAmount.toFixed(7)).toBe("28.5714286");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`${baseCfg.baseUrl}/rates/XLMPHP`);
    expect((init?.headers as Record<string, string>)["Access-Key"]).toBe("AK_TEST");
  });

  it("sellCryptoForPhp posts XLM->PHP and maps reference to tradeRef", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ reference: "TR-123" }));
    const p = createPdaxProvider({ ...baseCfg, fetchImpl });
    const r = await p.sellCryptoForPhp({
      ref: "TXN-A",
      asset: "XLM",
      amount: new Decimal("28.5714286"),
    });
    expect(r.tradeRef).toBe("TR-123");
    const [, init] = fetchImpl.mock.calls[0]!;
    const sent = JSON.parse(String(init?.body));
    expect(sent.traded_currency).toBe("XLM");
    expect(sent.settlement_currency).toBe("PHP");
    expect(sent.side).toBe("sell");
  });

  it("getTradeStatus maps FILLED with fee on PHP", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "FILLED",
        settlement_fee: "1.00",
        filled_settlement_amount: "100.00",
      }),
    );
    const p = createPdaxProvider({ ...baseCfg, fetchImpl });
    const s = await p.getTradeStatus("TR-123");
    expect(s.state).toBe("FILLED");
    expect(s.feePhp?.toFixed(2)).toBe("1.00");
    expect(s.filledPhp?.toFixed(2)).toBe("100.00");
  });

  it("cashOutPhpToBank posts PHP cash-out WITHOUT an OTP header and maps payoutRef", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ reference: "CO-9" }));
    const p = createPdaxProvider({ ...baseCfg, fetchImpl });
    const r = await p.cashOutPhpToBank({
      ref: "TXN-A",
      phpAmount: new Decimal("99.00"),
      bank: { bankCode: "BDO", accountName: "Jane", accountNumber: "1234567890" },
    });
    expect(r.payoutRef).toBe("CO-9");
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["Access-Otp"]).toBeUndefined();
  });

  it("getPayoutStatus maps SETTLED with netPhp", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ status: "SETTLED", net_amount: "99.00" }),
    );
    const p = createPdaxProvider({ ...baseCfg, fetchImpl });
    const s = await p.getPayoutStatus("CO-9");
    expect(s.state).toBe("SETTLED");
    expect(s.netPhp?.toFixed(2)).toBe("99.00");
  });

  it("withdrawCryptoForRefund attaches an Access-Otp header (TOTP)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ reference: "WD-1" }));
    const p = createPdaxProvider({ ...baseCfg, fetchImpl });
    const r = await p.withdrawCryptoForRefund({
      ref: "TXN-A",
      xlmAmount: new Decimal("28.5714286"),
      destination: "GBBB...",
    });
    expect(r.withdrawRef).toBe("WD-1");
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["Access-Otp"]).toMatch(/^\d{6}$/);
  });
});

describe("PdaxProvider resilience + validation", () => {
  it("retries on a 5xx then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "down" }, 503))
      .mockResolvedValueOnce(jsonResponse({ reference: "TR-RETRY" }));
    const p = createPdaxProvider({ ...baseCfg, fetchImpl });
    const r = await p.sellCryptoForPhp({ ref: "TXN-R", asset: "XLM", amount: new Decimal("1") });
    expect(r.tradeRef).toBe("TR-RETRY");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 4xx and throws", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: "bad" }, 400));
    const p = createPdaxProvider({ ...baseCfg, fetchImpl });
    await expect(
      p.sellCryptoForPhp({ ref: "TXN-B", asset: "XLM", amount: new Decimal("1") }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws on a malformed (schema-violating) response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ not_a_reference: true }));
    const p = createPdaxProvider({ ...baseCfg, fetchImpl });
    await expect(
      p.sellCryptoForPhp({ ref: "TXN-C", asset: "XLM", amount: new Decimal("1") }),
    ).rejects.toThrow();
  });
});
