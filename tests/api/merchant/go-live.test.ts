import { it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../../helpers/db";
import { mockSession, seedMerchantUser } from "../../helpers/merchant";

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

const USER = { id: "", username: "biz", role: "MERCHANT" as const, isActive: true };
mockSession(USER);
const req = () =>
  new NextRequest("http://localhost:3000/api/merchant/go-live", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
  });
const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
  delete process.env.MERCHANT_REVIEW_GATE;
});

it("activates a fully-configured merchant", async () => {
  const { user } = await seedMerchantUser({ status: "DRAFT" });
  USER.id = user.id;
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
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/go-live/route");
  const res = await POST(req(), ctx);
  expect(res.status).toBe(400);
});

it("routes to PENDING_REVIEW behind the feature flag", async () => {
  process.env.MERCHANT_REVIEW_GATE = "1";
  const { user } = await seedMerchantUser({ status: "DRAFT" });
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/go-live/route");
  const res = await POST(req(), ctx);
  expect((await res.json()).merchant.status).toBe("PENDING_REVIEW");
});
