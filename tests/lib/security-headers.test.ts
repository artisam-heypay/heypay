import { describe, it, expect } from "vitest";
import { buildCsp, applySecurityHeaders } from "@/lib/security-headers";

describe("buildCsp", () => {
  it("allowlists Google Fonts + Material Symbols and locks down the rest", () => {
    const csp = buildCsp();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});

describe("applySecurityHeaders", () => {
  const headersOf = () => {
    const res = { headers: new Headers() };
    applySecurityHeaders(res);
    return res.headers;
  };

  it("sets the full hardening header set", () => {
    const h = headersOf();
    expect(h.get("Strict-Transport-Security")).toContain("max-age=");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Content-Security-Policy")).toContain("default-src 'self'");
  });

  it("lets same-origin pages use the camera (a client-side link to the scanner keeps the old document's policy)", () => {
    const policy = headersOf().get("Permissions-Policy");
    expect(policy).toContain("camera=(self)");
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("geolocation=()");
  });
});
