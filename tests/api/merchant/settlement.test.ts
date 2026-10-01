import { it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, prisma } from "../../helpers/db";
import { mockSession, seedMerchantUser } from "../../helpers/merchant";
import { decryptSecret } from "@/server/crypto/envelope";

const USER = { id: "", username: "biz", role: "MERCHANT" as const, isActive: true };
mockSession(USER);
const req = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/merchant/settlement", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
});

it("stores encrypted account + last4 + resolved bank name", async () => {
  const { merchant, user } = await seedMerchantUser({
    settlementBankCode: "",
    accountNumberLast4: "",
    accountNumber: "",
    accountName: "",
  });
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/settlement/route");
  const res = await POST(
    req({ bankCode: "BPI", accountName: "Maria Cruz", accountNumber: "1234567890" }),
    ctx,
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.merchant.settlementBankName).toBe("Bank of the Philippine Islands");
  expect(body.merchant.accountNumberLast4).toBe("7890");
  expect(body.merchant).not.toHaveProperty("accountNumber");

  const row = await prisma.merchant.findUnique({ where: { id: merchant.id } });
  expect(row!.accountNumber).not.toContain("1234567890"); // encrypted at rest
  expect(decryptSecret(row!.accountNumber)).toBe("1234567890"); // round-trips
});

it("rejects an unsupported bank code with 400", async () => {
  const { user } = await seedMerchantUser({});
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/settlement/route");
  const res = await POST(
    req({ bankCode: "FAKEBANK", accountName: "X Y", accountNumber: "12345678" }),
    ctx,
  );
  expect(res.status).toBe(400);
});
