import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/auth/sessions", () => ({
  SESSION_COOKIE: "heypay_session",
  lookupSession: async () => ({ id: "u1", username: "payer", role: "PAYER", isActive: true }),
}));

import { proxy } from "@/proxy";

function request(path: string) {
  return new NextRequest(new URL(path, "https://app.heypayfi.xyz"));
}

describe("proxy", () => {
  it("serves the 403 page for another role's page, keeping the URL", async () => {
    const res = await proxy(request("/merchant/dashboard"));
    expect(res.status).toBe(403);
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://app.heypayfi.xyz/403");
  });
});
