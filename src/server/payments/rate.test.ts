import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";

const { getQuote, supportsAsset } = vi.hoisted(() => ({
  getQuote: vi.fn(),
  supportsAsset: vi.fn((_asset: string) => true),
}));
vi.mock("@/server/rails", () => ({
  rail: {
    supportsAsset: (a: string) => supportsAsset(a),
    getQuote: (i: unknown) => getQuote(i),
  },
}));

import { getAssetRate } from "./rate";

/** Write a snapshot aged `ageMs` into the past. */
async function seedSnapshot(pair: string, rate: string, ageMs = 0) {
  await db.exchangeRateSnapshot.create({
    data: { pair, rate, source: "PDAX", fetchedAt: new Date(Date.now() - ageMs) },
  });
}

const STALE = 10 * 60_000; // older than the 5-minute TTL

describe("getAssetRate", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    supportsAsset.mockReturnValue(true);
    await resetDb();
  });

  it("serves a fresh snapshot without touching the rail", async () => {
    await seedSnapshot("USDTPHP", "58.00000000");
    expect((await getAssetRate("USDT"))?.toFixed(2)).toBe("58.00");
    expect(getQuote).not.toHaveBeenCalled();
  });

  it("re-probes once the snapshot is stale, and persists the new rate", async () => {
    await seedSnapshot("USDCPHP", "50.00000000", STALE);
    getQuote.mockResolvedValue({ rate: dec("61.677") });

    expect((await getAssetRate("USDC"))?.toFixed(3)).toBe("61.677");
    expect(getQuote).toHaveBeenCalled();

    // Persisted, so the next read is a cheap DB hit rather than a rail call.
    const latest = await db.exchangeRateSnapshot.findFirstOrThrow({
      where: { pair: "USDCPHP" },
      orderBy: { fetchedAt: "desc" },
    });
    expect(latest.rate.toFixed(3)).toBe("61.677");

    getQuote.mockClear();
    expect((await getAssetRate("USDC"))?.toFixed(3)).toBe("61.677");
    expect(getQuote).not.toHaveBeenCalled();
  });

  it("falls back to a stale rate when the probe fails, rather than hiding the token", async () => {
    // A null rate blanks the token's value and drops it from the portfolio
    // total; a rate from ten minutes ago is a far better answer.
    await seedSnapshot("USDCPHP", "61.00000000", STALE);
    getQuote.mockRejectedValue(new Error("PDAX 500"));

    expect((await getAssetRate("USDC"))?.toFixed(2)).toBe("61.00");
  });

  it("escalates the probe when the pair's minimum trade size rejects ₱100", async () => {
    // PDAX prices USDTPHP only above ~₱500; a single ₱100 probe would report no
    // rate at all and the wallet would show the token as unpriced.
    getQuote.mockImplementation(
      async ({ phpAmount }: { phpAmount: import("@/lib/money").Decimal }) => {
        if (phpAmount.lessThan(dec("500"))) {
          throw new Error("Order quantity is less than minimum required quantity");
        }
        return { rate: dec("61.34") };
      },
    );

    expect((await getAssetRate("USDT"))?.toFixed(2)).toBe("61.34");
    expect(getQuote).toHaveBeenCalledTimes(2);
  });

  it("costs a single call for a pair that prices at the first probe", async () => {
    getQuote.mockResolvedValue({ rate: dec("7.299") });
    expect((await getAssetRate("XLM"))?.toString()).toBe("7.299");
    expect(getQuote).toHaveBeenCalledOnce();
  });

  it("returns null when a never-priced asset fails every probe", async () => {
    getQuote.mockRejectedValue(new Error("Asset unavailable"));
    expect(await getAssetRate("USDT")).toBeNull();
    expect(getQuote).toHaveBeenCalledTimes(3);
  });

  it("returns null for an asset the rail no longer trades, even with a snapshot", async () => {
    // A stale rate would imply the token is still sellable for PHP.
    await seedSnapshot("USDCPHP", "61.00000000", STALE);
    supportsAsset.mockReturnValue(false);

    expect(await getAssetRate("USDC")).toBeNull();
    expect(getQuote).not.toHaveBeenCalled();
  });
});
