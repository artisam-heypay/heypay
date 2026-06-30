import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, prisma } from "../../helpers/db";

const { sessionUser } = vi.hoisted(() => ({
  sessionUser: {
    current: null as null | { id: string; username: string; role: "MERCHANT"; isActive: boolean },
  },
}));

vi.mock("@/server/auth/sessions", async () => {
  const { forbidden, unauthorized } = await import("@/lib/errors");
  return {
    requireRole: vi.fn(async () => {
      if (!sessionUser.current) throw forbidden();
      return sessionUser.current;
    }),
    requireUser: vi.fn(async () => {
      if (!sessionUser.current) throw unauthorized();
      return sessionUser.current;
    }),
  };
});

const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost:3000/api/merchant", {
    method,
    headers: {
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const ctx = { params: Promise.resolve({}) };

describe("merchant profile API", () => {
  beforeEach(async () => {
    await resetDb();
    const u = await prisma.user.create({
      data: { username: "biz", passwordHash: "x", role: "MERCHANT" },
    });
    sessionUser.current = { id: u.id, username: "biz", role: "MERCHANT", isActive: true };
  });

  it("POST /api/merchant creates a DRAFT with empty placeholders", async () => {
    const { POST } = await import("@/app/api/merchant/route");
    const res = await POST(req("POST", { businessName: "Coffee Co" }), ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.merchant.status).toBe("DRAFT");
    expect(body.merchant.businessName).toBe("Coffee Co");
    expect(body.merchant.accountNumberLast4).toBe("");
    expect(body.merchant).not.toHaveProperty("accountNumber");
  });

  it("POST /api/merchant is conflict when one already exists", async () => {
    const { POST } = await import("@/app/api/merchant/route");
    await POST(req("POST", { businessName: "First" }), ctx);
    const res = await POST(req("POST", { businessName: "Second" }), ctx);
    expect(res.status).toBe(409);
  });

  it("GET /api/merchant/me returns merchant + setup; PATCH updates name", async () => {
    const { POST } = await import("@/app/api/merchant/route");
    await POST(req("POST", { businessName: "Coffee Co" }), ctx);
    const me = await import("@/app/api/merchant/me/route");
    const got = await me.GET(req("GET"), ctx);
    const gotBody = await got.json();
    expect(gotBody.setup.isComplete).toBe(false);
    const patched = await me.PATCH(req("PATCH", { businessName: "Bean Co" }), ctx);
    expect((await patched.json()).merchant.businessName).toBe("Bean Co");
  });
});
