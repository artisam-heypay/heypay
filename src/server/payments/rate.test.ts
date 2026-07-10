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

describe("getAssetRate", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    supportsAsset.mockReturnValue(true);
    await resetDb();
  });

  it("prefers the most recent persisted snapshot over a live probe", async () => {
    await db.exchangeRateSnapshot.create({
      data: { pair: "USDTPHP", rate: "58.00000000", source: "PDAX" },
    });
    const rate = await getAssetRate("USDT");
    expect(rate?.toFixed(2)).toBe("58.00");
    expect(getQuote).not.toHaveBeenCalled();
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

    const rate = await getAssetRate("USDT");
    expect(rate?.toFixed(2)).toBe("61.34");
    expect(getQuote).toHaveBeenCalledTimes(2);
  });

  it("costs a single call for a pair that prices at the first probe", async () => {
    getQuote.mockResolvedValue({ rate: dec("7.299") });
    expect((await getAssetRate("XLM"))?.toString()).toBe("7.299");
    expect(getQuote).toHaveBeenCalledOnce();
  });

  it("returns null when every probe is rejected", async () => {
    getQuote.mockRejectedValue(new Error("Asset unavailable"));
    expect(await getAssetRate("USDT")).toBeNull();
    expect(getQuote).toHaveBeenCalledTimes(3);
  });

  it("does not probe a rail that cannot price the asset", async () => {
    supportsAsset.mockReturnValue(false);
    expect(await getAssetRate("USDC")).toBeNull();
    expect(getQuote).not.toHaveBeenCalled();
  });
});
