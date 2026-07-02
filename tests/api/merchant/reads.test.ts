import { it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../../helpers/db";
import { mockSession, seedMerchantUser, seedPayment } from "../../helpers/merchant";

const USER = { id: "", username: "biz", role: "MERCHANT" as const, isActive: true };
mockSession(USER);
const get = (url: string) =>
  new NextRequest(url, { method: "GET", headers: { origin: "http://localhost:3000" } });
const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
  process.env.APP_URL = "http://localhost:3000";
});

it("earnings sums settled + pending", async () => {
  const { merchant, user } = await seedMerchantUser({});
  USER.id = user.id;
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
  USER.id = user.id;
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
  USER.id = user.id;
  const { GET } = await import("@/app/api/merchant/qr/route");
  const body = await (await GET(get("http://localhost:3000/api/merchant/qr"), ctx)).json();
  expect(body.qrSvg).toContain("<svg");
  expect(body.paymentLink).toContain("http://localhost:3000");
});
