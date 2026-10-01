import { describe, it, expect, afterEach, vi } from "vitest";
import { Decimal } from "@/lib/money";
import { createPdaxInstiProvider } from "@/server/rails/pdax-insti";

const baseCfg = {
  baseUrl: "https://uat.example/api/pdax-api",
  username: "u",
  password: "p",
  now: () => 1_700_000_000_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const LOGIN = { access_token: "at", id_token: "it", expiry: 600 };

/** Answers /login, then delegates the next call to `handler`. */
function fetchStub(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/login")) return jsonResponse(LOGIN);
    return handler(url, init);
  });
}

afterEach(() => {
  delete process.env.PDAX_SETTLEMENT_ASSETS;
  delete process.env.PDAX_INSTI_QTY_STEP_USDT;
  delete process.env.PDAX_XLM_DEPOSIT_ADDRESS;
  delete process.env.PDAX_USDC_DEPOSIT_ADDRESS;
});

describe("PdaxInstiProvider.getDepositAddress", () => {
  it("asks for USDC on Stellar as currency=USDCXLM and returns the tag as memo", async () => {
    let seen = "";
    const fetchImpl = fetchStub((url) => {
      seen = url;
      return jsonResponse({
        data: { currency: "USDCXLM", address: "GDEPOSIT", tag: "123123123" },
        status: "success",
      });
    });
    const p = createPdaxInstiProvider({ ...baseCfg, fetchImpl });

    const res = await p.getDepositAddress("USDC");
    expect(res).toEqual({ address: "GDEPOSIT", memo: "123123123" });
    expect(seen).toContain("/pdax-institution/v1/crypto/deposit?currency=USDCXLM");
  });

  it("asks for native XLM as currency=XLM, not XLMXLM", async () => {
    let seen = "";
    const fetchImpl = fetchStub((url) => {
      seen = url;
      return jsonResponse({ data: { currency: "XLM", address: "GXLM" }, status: "success" });
    });
    const p = createPdaxInstiProvider({ ...baseCfg, fetchImpl });

    await p.getDepositAddress("XLM");
    expect(seen).toContain("currency=XLM");
    expect(seen).not.toContain("XLMXLM");
  });

  it("reports a null memo when PDAX returns no tag", async () => {
    const fetchImpl = fetchStub(() =>
      jsonResponse({ data: { currency: "USDTXLM", address: "GDEP" }, status: "success" }),
    );
    const p = createPdaxInstiProvider({ ...baseCfg, fetchImpl });
    expect(await p.getDepositAddress("USDT")).toEqual({ address: "GDEP", memo: null });
  });

  it("prefers a pinned address and never calls PDAX for it", async () => {
    process.env.PDAX_XLM_DEPOSIT_ADDRESS = "GPINNED";
    const fetchImpl = fetchStub(() => {
      throw new Error("must not be called");
    });
    const p = createPdaxInstiProvider({ ...baseCfg, fetchImpl });

    expect(await p.getDepositAddress("XLM")).toEqual({ address: "GPINNED", memo: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("PdaxInstiProvider asset support", () => {
  it("quotes USDC against PHP using quote_currency=USDC", async () => {
    process.env.PDAX_SETTLEMENT_ASSETS = "XLM,USDC";
    let seen = "";
    const fetchImpl = fetchStub((url) => {
      seen = url;
      return jsonResponse({ data: { price: 58.196, base_quantity: 17.18 }, status: "success" });
    });
    const p = createPdaxInstiProvider({ ...baseCfg, fetchImpl });

    const q = await p.getQuote({ sell: "USDC", buy: "PHP", phpAmount: new Decimal("1000.00") });
    expect(seen).toContain("quote_currency=USDC");
    expect(seen).toContain("base_currency=PHP");
    expect(q.asset).toBe("USDC");
    expect(q.rate.toString()).toBe("58.196");
    // 1000 / 58.196 = 17.18331... → ROUND_UP at 7dp
    expect(q.assetAmount.toFixed(7)).toBe("17.1833116");
  });

  it("sells USDC with quote_currency=USDC on the firm quote", async () => {
    process.env.PDAX_SETTLEMENT_ASSETS = "XLM,USDC";
    const bodies: string[] = [];
    const fetchImpl = fetchStub((url, init) => {
      bodies.push(String(init?.body ?? ""));
      if (url.includes("/trade/quote")) {
        return jsonResponse({ data: { quote_id: "q1", expires_at: "2026-01-01T00:00:00Z" } });
      }
      return jsonResponse({ data: { order_id: 42, status: "successful" } });
    });
    const p = createPdaxInstiProvider({ ...baseCfg, fetchImpl });

    const r = await p.sellCryptoForPhp({
      ref: "TXN-A",
      asset: "USDC",
      amount: new Decimal("17.18"),
    });
    expect(r.tradeRef).toBe("42");
    expect(JSON.parse(bodies[0]!)).toMatchObject({ quote_currency: "USDC", side: "sell" });
  });

  it("refuses an asset the account is not configured to trade", async () => {
    process.env.PDAX_SETTLEMENT_ASSETS = "XLM";
    const p = createPdaxInstiProvider({ ...baseCfg, fetchImpl: fetchStub(() => jsonResponse({})) });

    expect(p.supportsAsset("USDC")).toBe(false);
    await expect(
      p.getQuote({ sell: "USDC", buy: "PHP", phpAmount: new Decimal("100") }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rounds a USDT sell to its 0.01 step, which PDAX enforces", async () => {
    // Probed on UAT: USDT accepts 3.01 but rejects 3.001 with OT010029
    // "Invalid Quantity Step" — and that rejection lands after the crypto has
    // already left the payer's wallet.
    process.env.PDAX_SETTLEMENT_ASSETS = "XLM,USDT";
    const bodies: string[] = [];
    const fetchImpl = fetchStub((url, init) => {
      bodies.push(String(init?.body ?? ""));
      if (url.includes("/trade/quote")) {
        return jsonResponse({ data: { quote_id: "q1", expires_at: "2026-01-01T00:00:00Z" } });
      }
      return jsonResponse({ data: { order_id: 7, status: "successful" } });
    });
    const p = createPdaxInstiProvider({ ...baseCfg, fetchImpl });

    await p.sellCryptoForPhp({ ref: "TXN-U", asset: "USDT", amount: new Decimal("3.2590000") });
    expect(JSON.parse(bodies[0]!).base_quantity).toBe("3.25");
  });

  it("reports the per-asset minimum sell amount", async () => {
    const p = createPdaxInstiProvider({ ...baseCfg, fetchImpl: fetchStub(() => jsonResponse({})) });
    expect(p.minSellAmount("XLM")?.toString()).toBe("10");
    expect(p.minSellAmount("USDC")?.toString()).toBe("1");
    expect(p.minSellAmount("USDT")?.toString()).toBe("2");
  });

  it("does not round a USDC sell to the XLM 0.5 quantity step", async () => {
    // The 0.5 step is an XLM-pair rule. Applying it to USDC would sell 17.0
    // instead of 17.18 and strand the remainder.
    process.env.PDAX_SETTLEMENT_ASSETS = "XLM,USDC";
    const bodies: string[] = [];
    const fetchImpl = fetchStub((url, init) => {
      bodies.push(String(init?.body ?? ""));
      if (url.includes("/trade/quote")) {
        return jsonResponse({ data: { quote_id: "q1", expires_at: "2026-01-01T00:00:00Z" } });
      }
      return jsonResponse({ data: { order_id: 1, status: "successful" } });
    });
    const p = createPdaxInstiProvider({ ...baseCfg, fetchImpl });

    await p.sellCryptoForPhp({ ref: "TXN-B", asset: "USDC", amount: new Decimal("17.18") });
    expect(JSON.parse(bodies[0]!).base_quantity).toBe("17.18");
  });
});
