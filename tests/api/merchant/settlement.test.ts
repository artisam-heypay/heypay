import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, prisma } from "../../helpers/db";
import { seedMerchantUser } from "../../helpers/merchant";
import { decryptSecret } from "@/server/crypto/envelope";

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

const req = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/merchant/settlement", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({}) };

const setUser = (id: string) =>
  (sessionUser.current = { id, username: "biz", role: "MERCHANT", isActive: true });

describe("merchant settlement API", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("stores encrypted account + last4 + resolved bank name", async () => {
    const { merchant, user } = await seedMerchantUser({
      settlementBankCode: "",
      settlementBankName: "",
      accountNumberLast4: "",
      accountNumber: "",
      accountName: "",
    });
    setUser(user.id);
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
    expect(row!.accountNumber).not.toContain("1234567890");
    expect(decryptSecret(row!.accountNumber)).toBe("1234567890");
  });

  it("rejects an unsupported bank code with 400", async () => {
    const { user } = await seedMerchantUser({});
    setUser(user.id);
    const { POST } = await import("@/app/api/merchant/settlement/route");
    const res = await POST(
      req({ bankCode: "FAKEBANK", accountName: "X Y", accountNumber: "12345678" }),
      ctx,
    );
    expect(res.status).toBe(400);
  });
});
