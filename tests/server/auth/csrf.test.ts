import { describe, it, expect, beforeAll } from "vitest";
import { assertSameOrigin } from "@/server/auth/csrf";

beforeAll(() => {
  process.env.APP_URL = "http://localhost:3000";
});

const mk = (method: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/auth/login", { method, headers });

describe("assertSameOrigin", () => {
  it("allows safe methods (GET) regardless of origin", () => {
    expect(() => assertSameOrigin(mk("GET", { "sec-fetch-site": "cross-site" }))).not.toThrow();
  });

  it("allows same-origin unsafe requests via Sec-Fetch-Site", () => {
    expect(() => assertSameOrigin(mk("POST", { "sec-fetch-site": "same-origin" }))).not.toThrow();
  });

  it("rejects cross-site unsafe requests", () => {
    expect(() => assertSameOrigin(mk("POST", { "sec-fetch-site": "cross-site" }))).toThrow();
    try {
      assertSameOrigin(mk("POST", { "sec-fetch-site": "cross-site" }));
    } catch (e) {
      expect((e as { status: number }).status).toBe(403);
    }
  });

  it("falls back to Origin when Sec-Fetch-Site is absent and rejects a foreign Origin", () => {
    expect(() => assertSameOrigin(mk("POST", { origin: "https://evil.example" }))).toThrow();
    expect(() => assertSameOrigin(mk("POST", { origin: "http://localhost:3000" }))).not.toThrow();
  });

  it("rejects an unsafe request with neither Sec-Fetch-Site nor Origin", () => {
    expect(() => assertSameOrigin(mk("POST"))).toThrow();
  });
});
