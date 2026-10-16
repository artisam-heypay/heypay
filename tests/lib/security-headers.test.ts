import { afterEach, describe, it, expect } from "vitest";
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

  describe("the Soroban RPC server", () => {
    const connectSrc = () =>
      buildCsp()
        .split("; ")
        .find((d) => d.startsWith("connect-src"))!;

    afterEach(() => {
      delete process.env.NONCUSTODIAL_ENABLED;
      delete process.env.SOROBAN_RPC_URL;
    });

    it("is not reachable from the browser by default", () => {
      process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      expect(connectSrc()).not.toContain("soroban");
    });

    it("is reachable while payers can build a deposit with their own wallet", () => {
      process.env.NONCUSTODIAL_ENABLED = "true";
      process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org/some/path";
      expect(connectSrc()).toContain(" https://soroban-testnet.stellar.org");
      expect(connectSrc()).not.toContain("/some/path"); // the origin, nothing else
    });

    it("adds nothing when the server is unset or not a URL", () => {
      process.env.NONCUSTODIAL_ENABLED = "true";
      const before = connectSrc();
      process.env.SOROBAN_RPC_URL = "not a url";
      expect(connectSrc()).toBe(before);
    });
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
