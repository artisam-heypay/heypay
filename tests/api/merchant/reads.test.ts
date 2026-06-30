import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../../helpers/db";
import { seedMerchantUser, seedPayment } from "../../helpers/merchant";

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

const get = (url: string) =>
  new NextRequest(url, { method: "GET", headers: { origin: "http://localhost:3000" } });
const ctx = { params: Promise.resolve({}) };
const setUser = (id: string) =>
  (sessionUser.current = { id, username: "biz", role: "MERCHANT", isActive: true });

describe("merchant read APIs", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.APP_URL = "http://localhost:3000";
  });

  it("earnings sums settled + pending", async () => {
    const { merchant, user } = await seedMerchantUser({});
    setUser(user.id);
    await seedPayment(merchant.id, {
      status: "SETTLED",
      netSettledPhp: "75.00",
      settledAt: new Date(),
    });
    const { GET } = await import("@/app/api/merchant/earnings/route");
    const body = await (await GET(get("http://localhost:3000/api/merchant/earnings"), ctx)).json();
    expect(body.totalSettledPhp).toBe("75.00");
  });

  it("transactions returns filtered settlement rows", async () => {
    const { merchant, user } = await seedMerchantUser({});
    setUser(user.id);
    await seedPayment(merchant.id, { status: "SETTLED", netSettledPhp: "10.00" });
    await seedPayment(merchant.id, { status: "FAILED" });
    const { GET } = await import("@/app/api/merchant/transactions/route");
    const body = await (
      await GET(get("http://localhost:3000/api/merchant/transactions?status=SETTLED"), ctx)
    ).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].status).toBe("SETTLED");
  });

  it("qr returns svg + payment link", async () => {
    const { user } = await seedMerchantUser({});
    setUser(user.id);
    const { GET } = await import("@/app/api/merchant/qr/route");
    const body = await (await GET(get("http://localhost:3000/api/merchant/qr"), ctx)).json();
    expect(body.qrSvg).toContain("<svg");
    expect(body.paymentLink).toContain("http://localhost:3000");
  });
});
