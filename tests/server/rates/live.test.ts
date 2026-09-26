import { describe, it, expect, vi } from "vitest";
import { createLiveRates } from "@/server/rates/live";
import { AppError } from "@/lib/errors";

const bookTicker = (symbol: string, bid: string) => ({
  status: 200,
  body: { symbol, bidPrice: bid, bidQty: "100", askPrice: "999", askQty: "100" },
});
const cmc = (asset: string, price: number) => ({
  status: 200,
  body: { status: { error_code: 0 }, data: { [asset]: [{ quote: { PHP: { price } } }] } },
});

/** Routes by host so the two sources can be failed independently. */
function fakeFetch(opts: {
  coinsph?: { status: number; body: unknown } | "down";
  cmc?: { status: number; body: unknown } | "down";
}) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const r = url.includes("coins.ph") ? opts.coinsph : opts.cmc;
    if (!r || r === "down") throw new Error("network down");
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
}

describe("live rates", () => {
  it("prices at the Coins.ph bid, not the ask", async () => {
    const fetchImpl = fakeFetch({ coinsph: bookTicker("XLMPHP", "13.565"), cmc: cmc("XLM", 13.55) });
    const rates = createLiveRates({ fetchImpl, cmcApiKey: "key" });
    const r = await rates.getRate("XLM");
    expect(r).toMatchObject({ asset: "XLM", source: "COINSPH" });
    expect(r.rate.toString()).toBe("13.565");
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("bookTicker?symbol=XLMPHP"),
      undefined,
    );
  });

  it("falls back to CoinMarketCap when Coins.ph is down", async () => {
    const fetchImpl = fakeFetch({ coinsph: "down", cmc: cmc("USDC", 62.34) });
    const r = await createLiveRates({ fetchImpl, cmcApiKey: "key" }).getRate("USDC");
    expect(r.source).toBe("CMC");
    expect(r.rate.toString()).toBe("62.34");
  });

  it("sends the CoinMarketCap key and asks for a PHP conversion", async () => {
    const fetchImpl = fakeFetch({ coinsph: "down", cmc: cmc("XLM", 13.5) });
    await createLiveRates({ fetchImpl, cmcApiKey: "secret-key" }).getRate("XLM");
    const cmcCall = fetchImpl.mock.calls.find(([u]) => u.includes("coinmarketcap"))!;
    expect(cmcCall[0]).toContain("symbol=XLM&convert=PHP");
    expect((cmcCall[1] as RequestInit).headers).toMatchObject({ "X-CMC_PRO_API_KEY": "secret-key" });
  });

  it("refuses to quote when the two sources disagree by more than the limit", async () => {
    const fetchImpl = fakeFetch({ coinsph: bookTicker("XLMPHP", "15.00"), cmc: cmc("XLM", 13.5) });
    const rates = createLiveRates({ fetchImpl, cmcApiKey: "key", maxDivergenceBps: 200 });
    await expect(rates.getRate("XLM")).rejects.toMatchObject({
      code: "RATE_UNAVAILABLE",
      status: 503,
    });
  });

  it("accepts a small disagreement within the limit", async () => {
    // 13.565 vs 13.5562 is ~0.07%
    const fetchImpl = fakeFetch({ coinsph: bookTicker("XLMPHP", "13.565"), cmc: cmc("XLM", 13.5562) });
    const r = await createLiveRates({ fetchImpl, cmcApiKey: "key", maxDivergenceBps: 200 }).getRate(
      "XLM",
    );
    expect(r.source).toBe("COINSPH");
  });

  it("throws a 503 AppError when no source answers", async () => {
    const fetchImpl = fakeFetch({ coinsph: "down", cmc: "down" });
    const err = await createLiveRates({ fetchImpl, cmcApiKey: "key" })
      .getRate("XLM")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(503);
  });

  it("uses Coins.ph alone, without calling CoinMarketCap, when no key is configured", async () => {
    const fetchImpl = fakeFetch({ coinsph: bookTicker("XLMPHP", "13.5") });
    const r = await createLiveRates({ fetchImpl, cmcApiKey: "" }).getRate("XLM");
    expect(r.source).toBe("COINSPH");
    expect(fetchImpl.mock.calls.every(([u]) => !u.includes("coinmarketcap"))).toBe(true);
  });

  it("rejects a malformed or non-positive price instead of quoting it", async () => {
    const fetchImpl = fakeFetch({ coinsph: bookTicker("XLMPHP", "0"), cmc: "down" });
    await expect(createLiveRates({ fetchImpl, cmcApiKey: "key" }).getRate("XLM")).rejects.toMatchObject(
      { status: 503 },
    );
  });

  it("reuses a CoinMarketCap answer inside the cache window to save credits", async () => {
    let now = 1_000_000;
    const fetchImpl = fakeFetch({ coinsph: "down", cmc: cmc("XLM", 13.5) });
    const rates = createLiveRates({ fetchImpl, cmcApiKey: "key", cmcCacheMs: 60_000, now: () => now });
    await rates.getRate("XLM");
    now += 30_000;
    await rates.getRate("XLM");
    const cmcCalls = () => fetchImpl.mock.calls.filter(([u]) => u.includes("coinmarketcap")).length;
    expect(cmcCalls()).toBe(1);
    now += 60_000;
    await rates.getRate("XLM");
    expect(cmcCalls()).toBe(2);
  });
});
