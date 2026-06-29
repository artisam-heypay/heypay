import { describe, it, expect } from "vitest";
import { dashboardPath } from "@/lib/auth-redirect";

describe("dashboardPath", () => {
  it("routes each role to its home surface", () => {
    expect(dashboardPath("PAYER")).toBe("/payer/dashboard");
    expect(dashboardPath("MERCHANT")).toBe("/merchant/dashboard");
    expect(dashboardPath("ADMIN")).toBe("/admin");
  });
});
