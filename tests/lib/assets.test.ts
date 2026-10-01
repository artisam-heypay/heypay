import { describe, it, expect } from "vitest";
import { enabledAssets, isAssetEnabled, assertAssetEnabled } from "@/lib/assets";
import { AppError } from "@/lib/errors";

describe("payment-asset feature flag", () => {
  it("defaults to XLM only when PAYMENT_ASSETS is unset or empty", () => {
    expect(enabledAssets(undefined)).toEqual(["XLM"]);
    expect(enabledAssets("")).toEqual(["XLM"]);
  });

  it("parses a comma-separated list, case-insensitively, and dedupes", () => {
    expect(enabledAssets("XLM,USDC")).toEqual(["XLM", "USDC"]);
    expect(enabledAssets(" xlm , usdc , usdt ")).toEqual(["XLM", "USDC", "USDT"]);
    expect(enabledAssets("XLM,XLM")).toEqual(["XLM"]);
  });

  it("ignores unknown tokens, falling back to XLM if nothing valid remains", () => {
    expect(enabledAssets("BTC,ETH")).toEqual(["XLM"]);
    expect(enabledAssets("XLM,BTC")).toEqual(["XLM"]);
  });

  it("isAssetEnabled reflects the configured set", () => {
    expect(isAssetEnabled("XLM", undefined)).toBe(true);
    expect(isAssetEnabled("USDC", undefined)).toBe(false);
    expect(isAssetEnabled("USDC", "XLM,USDC")).toBe(true);
  });

  it("assertAssetEnabled passes for enabled assets", () => {
    expect(() => assertAssetEnabled("XLM", undefined)).not.toThrow();
    expect(() => assertAssetEnabled("USDT", "XLM,USDT")).not.toThrow();
  });

  it("assertAssetEnabled throws a 400 AppError for a disabled asset", () => {
    try {
      assertAssetEnabled("USDC", undefined);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.status).toBe(400);
      expect(appErr.details).toMatchObject({ asset: "USDC", enabled: ["XLM"] });
    }
  });
});
