import { describe, it, expect, afterEach, vi } from "vitest";
import type { Horizon } from "@stellar/stellar-sdk";
import { dec } from "@/lib/money";

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Both routes Horizon actually returns for USDC -> XLM on testnet today. */
const RECORDS = [
  {
    source_amount: "0.0024588",
    path: [{ asset_type: "credit_alphanum4", asset_code: "CETES", asset_issuer: ISSUER }],
  },
  { source_amount: "307.9232509", path: [] },
];

function fakeServer(records: unknown[]): Horizon.Server {
  return {
    strictReceivePaths: vi.fn().mockReturnValue({ call: vi.fn().mockResolvedValue({ records }) }),
  } as unknown as Horizon.Server;
}

afterEach(() => {
  delete process.env.SETTLEMENT_DIRECT_ONLY;
  delete process.env.USDC_ASSET_ISSUER;
  vi.resetModules();
});

/** Re-import so the module re-reads SETTLEMENT_DIRECT_ONLY. */
async function load() {
  process.env.USDC_ASSET_ISSUER = ISSUER;
  return (await import("@/server/stellar/paths")).findConversionRoute;
}

describe("findConversionRoute", () => {
  it("takes the cheapest route, hops included", async () => {
    const find = await load();
    const route = await find("USDC", "XLM", dec("137.5137514"), fakeServer(RECORDS));
    expect(route!.sourceAmount.toFixed(7)).toBe("0.0024588");
    expect(route!.path).toHaveLength(1); // via CETES
  });

  it("trades only the direct book when SETTLEMENT_DIRECT_ONLY is set", async () => {
    process.env.SETTLEMENT_DIRECT_ONLY = "true";
    const find = await load();
    const route = await find("USDC", "XLM", dec("137.5137514"), fakeServer(RECORDS));
    expect(route!.path).toHaveLength(0);
    // On testnet the direct book is far worse — the quote guard then rejects it.
    expect(route!.sourceAmount.toFixed(7)).toBe("307.9232509");
  });

  it("reports no route when direct-only is set and only hops exist", async () => {
    process.env.SETTLEMENT_DIRECT_ONLY = "true";
    const find = await load();
    const route = await find("USDC", "XLM", dec("137.5137514"), fakeServer([RECORDS[0]]));
    expect(route).toBeNull();
  });

  it("reports no route when the DEX offers none", async () => {
    const find = await load();
    expect(await find("USDT", "XLM", dec("100"), fakeServer([]))).toBeNull();
  });

  it("reports no route when Horizon errors rather than throwing", async () => {
    const find = await load();
    const server = {
      strictReceivePaths: vi
        .fn()
        .mockReturnValue({ call: vi.fn().mockRejectedValue(new Error("404")) }),
    } as unknown as Horizon.Server;
    expect(await find("USDC", "XLM", dec("100"), server)).toBeNull();
  });
});
