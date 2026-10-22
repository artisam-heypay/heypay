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

describe("WalletConnect, for Freighter's mobile app", () => {
  const directive = (name: string) =>
    buildCsp()
      .split("; ")
      .find((d) => d.startsWith(`${name} `));

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  });

  it("is out of reach until a project id is set", () => {
    expect(buildCsp()).not.toContain("walletconnect");
    expect(directive("frame-src")).toBeUndefined();
  });

  it("can reach its relay, its modal's API and fonts, and frame its verify page once set", () => {
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = "wc-project";
    expect(directive("connect-src")).toContain(" wss://relay.walletconnect.org");
    expect(directive("connect-src")).toContain(" https://api.web3modal.org");
    expect(directive("font-src")).toContain(" https://fonts.reown.com");
    expect(directive("frame-src")).toContain(" https://verify.walletconnect.org");
    expect(buildCsp()).not.toContain("; ;"); // nothing empty left between directives
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
