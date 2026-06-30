import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../../helpers/db";
import { seedMerchantUser } from "../../helpers/merchant";

vi.mock("@/server/qrph/decode", () => ({
  decodeQrph: (raw: string) => ({
    raw,
    crcValid: raw.length > 10,
    country: "PH",
    currency: "608",
    pointOfInit: "static",
    payloadFormat: "01",
  }),
}));

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

const req = () =>
  new NextRequest("http://localhost:3000/api/merchant/go-live", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
  });
const ctx = { params: Promise.resolve({}) };
const setUser = (id: string) =>
  (sessionUser.current = { id, username: "biz", role: "MERCHANT", isActive: true });

describe("merchant go-live API", () => {
  beforeEach(async () => {
    await resetDb();
    delete process.env.MERCHANT_REVIEW_GATE;
  });

  it("activates a fully-configured merchant", async () => {
    const { user } = await seedMerchantUser({ status: "DRAFT" });
    setUser(user.id);
    const { POST } = await import("@/app/api/merchant/go-live/route");
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).merchant.status).toBe("ACTIVE");
  });

  it("blocks go-live with 400 when settlement is missing", async () => {
    const { user } = await seedMerchantUser({
      status: "DRAFT",
      settlementBankCode: "",
      accountNumberLast4: "",
    });
    setUser(user.id);
    const { POST } = await import("@/app/api/merchant/go-live/route");
    const res = await POST(req(), ctx);
    expect(res.status).toBe(400);
  });

  it("routes to PENDING_REVIEW behind the feature flag", async () => {
    process.env.MERCHANT_REVIEW_GATE = "1";
    const { user } = await seedMerchantUser({ status: "DRAFT" });
    setUser(user.id);
    const { POST } = await import("@/app/api/merchant/go-live/route");
    const res = await POST(req(), ctx);
    expect((await res.json()).merchant.status).toBe("PENDING_REVIEW");
  });
});
