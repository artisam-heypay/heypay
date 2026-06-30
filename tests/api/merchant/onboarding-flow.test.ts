import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, prisma } from "../../helpers/db";

const RAW =
  "00020101021128660011ph.ppmi.p2m0111PARTNERBANK0208123456780308MERCHID01520400005303608" +
  "5802PH5909HEYPAY CAFE6005DAVAO63041A2B";
vi.mock("@/server/qrph/decode", () => ({
  decodeQrph: (raw: string) => ({
    raw,
    payloadFormat: "01",
    pointOfInit: "static",
    merchantName: "HEYPAY CAFE",
    merchantCity: "DAVAO",
    merchantId: "MERCHID01",
    acquirerId: "PARTNERBANK",
    country: "PH",
    currency: "608",
    crcValid: true,
  }),
}));
vi.mock("@/server/storage/s3", () => ({ verifyUploadedObject: vi.fn(async () => {}) }));

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

const ctx = { params: Promise.resolve({}) };
const post = (path: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

describe("merchant onboarding flow", () => {
  beforeEach(async () => {
    await resetDb();
    const u = await prisma.user.create({
      data: { username: "owner", passwordHash: "x", role: "MERCHANT" },
    });
    sessionUser.current = { id: u.id, username: "owner", role: "MERCHANT", isActive: true };
  });

  it("walks create → settlement → qrph → go-live to ACTIVE", async () => {
    const create = await import("@/app/api/merchant/route");
    const settle = await import("@/app/api/merchant/settlement/route");
    const qrph = await import("@/app/api/merchant/qrph/route");
    const live = await import("@/app/api/merchant/go-live/route");

    expect(
      (await create.POST(post("/api/merchant", { businessName: "HeyPay Cafe" }), ctx)).status,
    ).toBe(201);
    expect(
      (
        await settle.POST(
          post("/api/merchant/settlement", {
            bankCode: "BPI",
            accountName: "Maria Cruz",
            accountNumber: "1234567890",
          }),
          ctx,
        )
      ).status,
    ).toBe(200);
    expect((await qrph.POST(post("/api/merchant/qrph", { raw: RAW }), ctx)).status).toBe(200);

    const res = await live.POST(post("/api/merchant/go-live"), ctx);
    expect((await res.json()).merchant.status).toBe("ACTIVE");
  });
});
