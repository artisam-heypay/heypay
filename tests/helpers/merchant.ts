import { vi } from "vitest";
import { prisma } from "./db";
import { encryptSecret } from "@/server/crypto/envelope";
import { newPaymentReference } from "@/server/payments/reference";
import type { Merchant, PaymentStatus } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/sessions";

/**
 * Mocks the sessions module so requireRole/requireUser/getSessionUser resolve to `user`.
 * Uses vi.doMock (non-hoisted) so it applies to the dynamic `await import("...route")`
 * calls the API tests perform after invoking this. The `user` object is captured by
 * reference, so tests may set `user.id` in beforeEach after calling mockSession.
 */
export function mockSession(user: SessionUser) {
  vi.doMock("@/server/auth/sessions", async (orig) => {
    const actual = await orig<typeof import("@/server/auth/sessions")>();
    return {
      ...actual,
      getSessionUser: vi.fn(async () => user),
      requireUser: vi.fn(async () => user),
      requireRole: vi.fn(async () => user),
    };
  });
}

let counter = 0;
const VALID_QRPH =
  // a CRC-valid static EMVCo QRPH fixture produced by the Phase 3 parser tests
  "00020101021128660011ph.ppmi.p2m0111PARTNERBANK0208123456780308MERCHID01520400005303608" +
  "5802PH5909HEYPAY CAFE6005DAVAO6304";

export async function seedMerchantUser(overrides: Partial<Merchant> = {}) {
  counter += 1;
  const user = await prisma.user.create({
    data: { username: `merchant${counter}-${Date.now()}`, passwordHash: "x", role: "MERCHANT" },
  });
  const merchant = await prisma.merchant.create({
    data: {
      userId: user.id,
      businessName: "HeyPay Cafe",
      status: "ACTIVE",
      qrphRaw: VALID_QRPH + "ABCD",
      qrphMerchantName: "HEYPAY CAFE",
      qrphMerchantId: "MERCHID01",
      qrphMerchantCity: "DAVAO",
      settlementBankCode: "BPI",
      settlementBankName: "Bank of the Philippine Islands",
      accountName: "Maria Cruz",
      accountNumber: encryptSecret("1234567890"),
      accountNumberLast4: "7890",
      ...overrides,
    },
  });
  return { user, merchant };
}

export async function seedPayment(
  merchantId: string,
  data: Partial<{
    status: PaymentStatus;
    netSettledPhp: string;
    amountAsset: string;
    settledAt: Date;
  }>,
) {
  counter += 1;
  const payer = await prisma.user.create({
    data: { username: `payer${counter}-${Date.now()}`, passwordHash: "x", role: "PAYER" },
  });
  return prisma.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: payer.id,
      merchantId,
      amountPhp: "100.00",
      quotedRate: "8.00000000",
      amountAsset: data.amountAsset ?? "12.5000000",
      netSettledPhp: data.netSettledPhp ?? null,
      status: data.status ?? "CREATED",
      settledAt: data.settledAt ?? null,
    },
  });
}
