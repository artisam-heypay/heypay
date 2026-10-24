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

it("transactions name the customer without their username", async () => {
  const { merchant, user } = await seedMerchantUser({});
  USER.id = user.id;
  const payment = await seedPayment(merchant.id, { status: "SETTLED", netSettledPhp: "10.00" });
  const { GET } = await import("@/app/api/merchant/transactions/route");
  const body = await (
    await GET(get("http://localhost:3000/api/merchant/transactions"), ctx)
  ).json();
  expect(body.items[0].customer).toBe(`Customer ••${payment.payerId.slice(-4).toUpperCase()}`);
  expect(JSON.stringify(body)).not.toMatch(/payer\d+-/);
});

it("qr downloads a PNG and a PDF standee named after the shop", async () => {
  const { user } = await seedMerchantUser({});
  USER.id = user.id;
  const { GET } = await import("@/app/api/merchant/qr/download/route");
  const download = (format: string) =>
    GET(get(`http://localhost:3000/api/merchant/qr/download?format=${format}`), ctx);

  const png = await download("png");
  expect(png.headers.get("content-type")).toBe("image/png");
  expect(png.headers.get("content-disposition")).toContain('filename="heypay-cafe-qr.png"');
  expect(
    Buffer.from(await png.arrayBuffer())
      .subarray(1, 4)
      .toString(),
  ).toBe("PNG");

  const pdf = await download("pdf");
  expect(pdf.headers.get("content-type")).toBe("application/pdf");
  const text = Buffer.from(await pdf.arrayBuffer()).toString("latin1");
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  expect(text).toContain("(HeyPay Cafe) Tj");
  expect(text.trimEnd().endsWith("%%EOF")).toBe(true);

  expect((await download("svg")).status).toBe(400);
});

it("qr returns svg + payment link", async () => {
  const { user } = await seedMerchantUser({});
  USER.id = user.id;
  const { GET } = await import("@/app/api/merchant/qr/route");
  const body = await (await GET(get("http://localhost:3000/api/merchant/qr"), ctx)).json();
  expect(body.qrSvg).toContain("<svg");
  expect(body.paymentLink).toContain("http://localhost:3000");
});
