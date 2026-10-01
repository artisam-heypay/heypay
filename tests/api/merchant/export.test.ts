import { it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../../helpers/db";
import { mockSession, seedMerchantUser, seedPayment } from "../../helpers/merchant";

const USER = { id: "", username: "biz", role: "MERCHANT" as const, isActive: true };
mockSession(USER);
const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
});

it("returns a text/csv attachment of settlement rows", async () => {
  const { merchant, user } = await seedMerchantUser({});
  USER.id = user.id;
  await seedPayment(merchant.id, { status: "SETTLED", netSettledPhp: "10.00" });
  const { GET } = await import("@/app/api/merchant/transactions/export/route");
  const res = await GET(
    new NextRequest("http://localhost:3000/api/merchant/transactions/export?status=SETTLED", {
      method: "GET",
      headers: { origin: "http://localhost:3000" },
    }),
    ctx,
  );
  expect(res.headers.get("content-type")).toContain("text/csv");
  expect(res.headers.get("content-disposition")).toContain("attachment");
  const text = await res.text();
  expect(text).toContain("Reference,Customer");
  expect(text).toContain("SETTLED");
});
