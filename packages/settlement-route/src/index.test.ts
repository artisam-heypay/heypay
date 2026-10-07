import { describe, expect, it } from "vitest";
import { createSettlementRouteResolver, type SettlementRouteChecks } from "./index";

type Asset = "XLM" | "USDC";

const PAYER = "GPAYER";
const TREASURY = "GTREASURY";
const ESCROW = "CESCROW";

/** A resolver over a network where `trust` lists the assets each account holds. */
function resolverFor(
  trust: Record<string, Asset[]>,
  over: Partial<SettlementRouteChecks<Asset, string, string>> = {},
) {
  return createSettlementRouteResolver<Asset, string, string>({
    fallbackAsset: "XLM",
    isIssuedAsset: (asset) => asset !== "XLM",
    getDepositAddress: async () => ({ address: TREASURY, memo: null }),
    canReceive: async (account, asset) => (trust[account] ?? []).includes(asset),
    holdsOtherIssuer: async () => false,
    findStrictSendPaths: async () => [],
    escrow: { appliesTo: () => false, contractId: () => null, holdsAsset: async () => true },
    ...over,
  });
}

const usdc = { asset: "USDC" as const, amount: "5.0000000", payerPublicKey: PAYER };

describe("createSettlementRouteResolver", () => {
  it("delivers the payer's own asset when the payer and the destination both hold it", async () => {
    const resolve = resolverFor({ [PAYER]: ["XLM", "USDC"], [TREASURY]: ["XLM", "USDC"] });
    expect(await resolve(usdc)).toEqual({
      ok: true,
      reason: null,
      escrowId: null,
      route: { mode: "direct", settlementAsset: "USDC", destination: TREASURY, memo: null },
    });
  });

  it("names the escrow instance that will hold the payment", async () => {
    const resolve = resolverFor(
      { [PAYER]: ["XLM", "USDC"], [TREASURY]: ["XLM", "USDC"] },
      { escrow: { appliesTo: () => true, contractId: () => ESCROW, holdsAsset: async () => true } },
    );
    expect(await resolve(usdc)).toMatchObject({ ok: true, escrowId: ESCROW });
  });

  it("refuses an escrow that would hold, and refund, a different token", async () => {
    const resolve = resolverFor(
      { [PAYER]: ["XLM", "USDC"], [TREASURY]: ["XLM", "USDC"] },
      {
        escrow: { appliesTo: () => true, contractId: () => ESCROW, holdsAsset: async () => false },
      },
    );
    expect(await resolve(usdc)).toMatchObject({ ok: false, reason: "escrow_holds_other_asset" });
  });

  it("refuses a payer who could not take the asset back in a refund", async () => {
    const resolve = resolverFor({ [PAYER]: ["XLM"], [TREASURY]: ["XLM", "USDC"] });
    expect(await resolve(usdc)).toMatchObject({ ok: false, reason: "payer_no_trustline" });
  });

  it("converts to the fallback asset when the destination cannot hold the payer's", async () => {
    const resolve = resolverFor(
      { [PAYER]: ["XLM", "USDC"], [TREASURY]: ["XLM"] },
      { findStrictSendPaths: async () => [{ destAmount: "34.8769555", path: [] }] },
    );
    expect(await resolve(usdc)).toMatchObject({
      ok: true,
      route: { mode: "path", settlementAsset: "XLM", destAmount: "34.8769555", path: [] },
    });
  });

  it("refuses a conversion the DEX has no route for", async () => {
    const resolve = resolverFor({ [PAYER]: ["XLM", "USDC"], [TREASURY]: ["XLM"] });
    expect(await resolve(usdc)).toMatchObject({ ok: false, reason: "no_dex_path" });
  });
});
