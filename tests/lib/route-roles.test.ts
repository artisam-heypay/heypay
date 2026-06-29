import { describe, it, expect } from "vitest";
import { requiredRoleForPath, evaluateAccess } from "@/lib/route-roles";

describe("requiredRoleForPath", () => {
  it("maps route groups to roles and leaves the rest public", () => {
    expect(requiredRoleForPath("/payer/dashboard")).toBe("PAYER");
    expect(requiredRoleForPath("/merchant/onboarding")).toBe("MERCHANT");
    expect(requiredRoleForPath("/admin/users")).toBe("ADMIN");
    expect(requiredRoleForPath("/login")).toBe("public");
    expect(requiredRoleForPath("/")).toBe("public");
  });
});

describe("evaluateAccess", () => {
  it("allows public routes for anyone, including anonymous", () => {
    expect(evaluateAccess("/login", null)).toBe("allow");
    expect(evaluateAccess("/login", "PAYER")).toBe("allow");
  });
  it("redirects anonymous users on protected routes to login", () => {
    expect(evaluateAccess("/payer/dashboard", null)).toBe("login");
  });
  it("allows a matching role", () => {
    expect(evaluateAccess("/payer/dashboard", "PAYER")).toBe("allow");
    expect(evaluateAccess("/admin/users", "ADMIN")).toBe("allow");
  });
  it("forbids a mismatched role", () => {
    expect(evaluateAccess("/payer/dashboard", "MERCHANT")).toBe("forbidden");
    expect(evaluateAccess("/admin/users", "PAYER")).toBe("forbidden");
  });
});
