import { describe, it, expect, afterEach } from "vitest";
import {
  assetIssuer,
  isAssetConfigured,
  matchPaymentAsset,
  resolveStellarAsset,
} from "@/server/stellar/assets";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const OTHER_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

afterEach(() => {
  delete process.env.USDT_ASSET_ISSUER;
  delete process.env.USDC_ASSET_ISSUER;
});

describe("resolveStellarAsset", () => {
  it("maps XLM to the native asset without needing an issuer", () => {
    const asset = resolveStellarAsset("XLM");
    expect(asset.isNative()).toBe(true);
    expect(assetIssuer("XLM")).toBeNull();
    expect(isAssetConfigured("XLM")).toBe(true);
  });

  it("maps USDT to code:issuer from the environment", () => {
    process.env.USDT_ASSET_ISSUER = ISSUER;
    const asset = resolveStellarAsset("USDT");
    expect(asset.getCode()).toBe("USDT");
    expect(asset.getIssuer()).toBe(ISSUER);
  });

  it("throws rather than guessing an issuer when one is not configured", () => {
    expect(isAssetConfigured("USDT")).toBe(false);
    expect(() => resolveStellarAsset("USDT")).toThrow(/USDT_ASSET_ISSUER/);
  });
});

describe("matchPaymentAsset", () => {
  it("recognises a native payment as XLM", () => {
    expect(matchPaymentAsset({ asset_type: "native" }, ["XLM", "USDT"])).toBe("XLM");
  });

  it("recognises USDT from the configured issuer", () => {
    process.env.USDT_ASSET_ISSUER = ISSUER;
    const rec = { asset_type: "credit_alphanum4", asset_code: "USDT", asset_issuer: ISSUER };
    expect(matchPaymentAsset(rec, ["XLM", "USDT"])).toBe("USDT");
  });

  it("rejects a same-code asset from a different issuer", () => {
    // The decisive detail: anyone can issue an asset called USDT. Only the
    // configured issuer's is real money to us.
    process.env.USDT_ASSET_ISSUER = ISSUER;
    const rec = { asset_type: "credit_alphanum4", asset_code: "USDT", asset_issuer: OTHER_ISSUER };
    expect(matchPaymentAsset(rec, ["XLM", "USDT"])).toBeNull();
  });

  it("rejects an asset that is not in the candidate list", () => {
    process.env.USDT_ASSET_ISSUER = ISSUER;
    const rec = { asset_type: "credit_alphanum4", asset_code: "USDT", asset_issuer: ISSUER };
    expect(matchPaymentAsset(rec, ["XLM"])).toBeNull();
  });

  it("rejects an issued asset when no issuer is configured", () => {
    const rec = { asset_type: "credit_alphanum4", asset_code: "USDT", asset_issuer: ISSUER };
    expect(matchPaymentAsset(rec, ["XLM", "USDT"])).toBeNull();
  });
});
