import { describe, it, expect, afterEach } from "vitest";
import { Asset, Networks } from "@stellar/stellar-sdk";
import { assetContract, railPayload } from "@/server/observability/payment-trail";

afterEach(() => {
  delete process.env.STELLAR_NETWORK;
  delete process.env.USDC_ASSET_ISSUER;
});

describe("payment trail", () => {
  it("names the native asset's contract, with no issuer", () => {
    expect(assetContract("XLM")).toEqual({
      asset_issuer: null,
      asset_contract_id: Asset.native().contractId(Networks.TESTNET),
    });
  });

  it("names an issued asset's issuer and contract", () => {
    const issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    const trail = assetContract("USDC");
    expect(trail.asset_issuer).toBe(issuer);
    expect(trail.asset_contract_id).toBe(new Asset("USDC", issuer).contractId(Networks.TESTNET));
    expect(trail.asset_contract_id).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it("reports nothing rather than throwing when the asset is not configured", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    expect(assetContract("USDC")).toEqual({ asset_issuer: null, asset_contract_id: null });
  });

  it("ships a rail payload as capped JSON text", () => {
    expect(railPayload(undefined)).toBeUndefined();
    expect(railPayload({ id: "disb-1" })).toBe('{"id":"disb-1"}');
    expect(railPayload({ blob: "x".repeat(20_000) })!.length).toBe(8_001);
  });
});
