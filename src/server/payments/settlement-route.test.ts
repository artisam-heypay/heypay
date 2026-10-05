import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dec } from "@/lib/money";

const TREASURY = "GTREASURY";
const PAYER = "GPAYER";
const XLM_ESCROW = "CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J";

const { getDepositAddress, canReceive, findStrictSendPaths } = vi.hoisted(() => ({
  getDepositAddress: vi.fn(),
  canReceive: vi.fn(),
  findStrictSendPaths: vi.fn(),
}));

vi.mock("@/server/rails", () => ({
  rail: { getDepositAddress: (a: string) => getDepositAddress(a) },
}));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: { canReceive: (pk: string, a: string) => canReceive(pk, a) },
}));
vi.mock("@/server/stellar/paths", () => ({
  findStrictSendPaths: (...args: unknown[]) => findStrictSendPaths(...args),
}));

import { resolveSettlementRoute } from "./settlement-route";

/** Which accounts hold which assets, as `canReceive` answers. */
function holdings(map: Record<string, string[]>) {
  canReceive.mockImplementation(async (pk: string, asset: string) =>
    (map[pk] ?? []).includes(asset),
  );
}

const resolve = (asset: "XLM" | "USDC", amount = "1.6041066") =>
  resolveSettlementRoute({ asset, amount: dec(amount), payerPublicKey: PAYER });

beforeEach(() => {
  vi.clearAllMocks();
  getDepositAddress.mockResolvedValue({ address: TREASURY, memo: null });
  holdings({ [PAYER]: ["XLM", "USDC"], [TREASURY]: ["XLM", "USDC"] });
  findStrictSendPaths.mockResolvedValue([]);
});
afterEach(() => {
  delete process.env.ESCROW_ENABLED;
  delete process.env.ESCROW_CONTRACT_ID;
});

describe("resolveSettlementRoute", () => {
  it("sends the payer's own asset straight to the treasury when the escrow is off", async () => {
    expect(await resolve("USDC")).toEqual({
      ok: true,
      reason: null,
      escrowId: null,
      route: { mode: "direct", settlementAsset: "USDC", destination: TREASURY, memo: null },
    });
    expect(findStrictSendPaths).not.toHaveBeenCalled();
  });

  it("names the escrow instance that will hold an escrowed asset", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID = XLM_ESCROW;
    const route = await resolve("XLM", "8.3333334");
    expect(route).toMatchObject({ ok: true, escrowId: XLM_ESCROW, route: { mode: "direct" } });
  });

  it("refuses when the escrow is on for the asset but no instance is deployed", async () => {
    process.env.ESCROW_ENABLED = "true";
    expect(await resolve("XLM")).toEqual({
      ok: false,
      reason: "no_escrow",
      escrowId: null,
      route: null,
    });
    // Nothing on-chain is asked about a payment that has nowhere to be held.
    expect(canReceive).not.toHaveBeenCalled();
  });

  it("refuses when the payer's account holds no trustline for the asset", async () => {
    holdings({ [PAYER]: ["XLM"], [TREASURY]: ["XLM", "USDC"] });
    expect(await resolve("USDC")).toMatchObject({ ok: false, reason: "payer_no_trustline" });
  });

  it("does not ask about a payer trustline for XLM, which needs none", async () => {
    await resolve("XLM");
    expect(canReceive).not.toHaveBeenCalledWith(PAYER, "XLM");
  });

  it("converts on the DEX when the destination only takes XLM and a route exists", async () => {
    holdings({ [PAYER]: ["XLM", "USDC"], [TREASURY]: ["XLM"] });
    findStrictSendPaths.mockResolvedValue([
      { destAmount: dec("9.7684000"), path: [] },
      { destAmount: dec("9.3400000"), path: [] },
    ]);
    const route = await resolve("USDC");
    expect(route).toMatchObject({
      ok: true,
      route: { mode: "path", settlementAsset: "XLM", destination: TREASURY },
    });
    expect(route.ok && route.route.mode === "path" && route.route.destAmount.toFixed(7)).toBe(
      "9.7684000",
    );
    expect(findStrictSendPaths).toHaveBeenCalledWith("USDC", "XLM", dec("1.6041066"));
  });

  it("refuses when the asset would have to be converted and the DEX has no route", async () => {
    holdings({ [PAYER]: ["XLM", "USDC"], [TREASURY]: ["XLM"] });
    expect(await resolve("USDC")).toMatchObject({ ok: false, reason: "no_dex_path" });
  });

  it("refuses when the destination can hold neither the asset nor XLM", async () => {
    holdings({ [PAYER]: ["XLM", "USDC"], [TREASURY]: [] });
    expect(await resolve("USDC")).toMatchObject({ ok: false, reason: "destination_no_trustline" });
    expect(await resolve("XLM")).toMatchObject({ ok: false, reason: "destination_no_trustline" });
    expect(findStrictSendPaths).not.toHaveBeenCalled();
  });

  it("never converts an escrowed asset: the escrow releases its own token", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID = XLM_ESCROW;
    holdings({ [PAYER]: ["XLM"], [TREASURY]: [] });
    expect(await resolve("XLM")).toEqual({
      ok: false,
      reason: "destination_no_trustline",
      escrowId: XLM_ESCROW,
      route: null,
    });
  });
});
