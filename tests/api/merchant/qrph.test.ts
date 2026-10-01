import { it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, prisma } from "../../helpers/db";
import { mockSession, seedMerchantUser } from "../../helpers/merchant";

// CRC-valid fixture string (matches Phase 3 parser fixtures)
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
    crcValid: raw === RAW,
    amountPhp: undefined,
  }),
}));
vi.mock("@/server/storage/s3", () => ({ verifyUploadedObject: vi.fn(async () => {}) }));

const USER = { id: "", username: "biz", role: "MERCHANT" as const, isActive: true };
mockSession(USER);
const req = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/merchant/qrph", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
});

it("persists decoded QRPH fields and verifies the uploaded image", async () => {
  const { verifyUploadedObject } = await import("@/server/storage/s3");
  const { merchant, user } = await seedMerchantUser({ qrphRaw: "" });
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/qrph/route");
  const res = await POST(req({ raw: RAW, imageKey: "qrph/abc.png" }), ctx);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.merchant.qrphMerchantName).toBe("HEYPAY CAFE");
  expect(body.merchant.qrphImageKey).toBe("qrph/abc.png");
  expect(verifyUploadedObject).toHaveBeenCalledWith("qrph/abc.png");
  const row = await prisma.merchant.findUnique({ where: { id: merchant.id } });
  expect(row!.qrphMerchantId).toBe("MERCHID01");
});

it("rejects a QRPH already owned by another merchant (409)", async () => {
  await seedMerchantUser({ qrphRaw: RAW, qrphMerchantId: "MERCHID01" }); // someone else owns it
  const { user } = await seedMerchantUser({ qrphRaw: "" });
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/qrph/route");
  const res = await POST(req({ raw: RAW }), ctx);
  expect(res.status).toBe(409);
});

it("rejects a CRC-invalid string (400)", async () => {
  const { user } = await seedMerchantUser({ qrphRaw: "" });
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/qrph/route");
  const res = await POST(req({ raw: RAW.slice(0, -4) + "0000" }), ctx);
  expect(res.status).toBe(400);
});
