import { describe, it, expect } from "vitest";
import { replayAllowed } from "@/components/analytics/PostHogProvider";

describe("replayAllowed", () => {
  it("records ordinary pages", () => {
    expect(replayAllowed("/payer/dashboard")).toBe(true);
    expect(replayAllowed("/merchant/transactions")).toBe(true);
    expect(replayAllowed("/")).toBe(true);
  });

  it("never records wallet, settings, camera or admin pages", () => {
    for (const path of [
      "/payer/prefund",
      "/payer/settings",
      "/payer/settings/password",
      "/payer/scan",
      "/merchant/settings",
      "/merchant/onboarding",
      "/admin",
      "/admin/merchants/abc",
    ]) {
      expect(replayAllowed(path), path).toBe(false);
    }
  });

  it("matches whole path segments only", () => {
    expect(replayAllowed("/payer/prefunding-guide")).toBe(true);
  });
});
