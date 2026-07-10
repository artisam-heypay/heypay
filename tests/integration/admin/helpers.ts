import { randomUUID, randomBytes, createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { cookieJar } from "../../helpers/mock-cookies";
import { resetDb, makePayer, makeMerchant } from "../../helpers/db";
import type { Decimal } from "@/lib/money";
import { newPaymentReference } from "@/server/payments/reference";
import { SESSION_COOKIE } from "@/server/auth/sessions";
import type { PaymentStatus, Role, MerchantStatus } from "@/generated/prisma/client";

export { resetDb };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function createTestSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  cookieJar.set(SESSION_COOKIE, token);
}

export async function asAdmin(): Promise<{ id: string; username: string }> {
  cookieJar.clear();
  const username = `admin-${randomUUID().slice(0, 8)}`;
  const user = await db.user.create({
    data: { username, passwordHash: "x", role: "ADMIN" },
  });
  await createTestSession(user.id);
  return { id: user.id, username: user.username };
}

export async function asPayer(): Promise<{ id: string; username: string }> {
  cookieJar.clear();
  const username = `payer-${randomUUID().slice(0, 8)}`;
  const user = await db.user.create({
    data: { username, passwordHash: "x", role: "PAYER" },
  });
  await createTestSession(user.id);
  return { id: user.id, username: user.username };
}

export function makeRequest(
  method: string,
  url: string,
  body?: unknown,
  extraHeaders?: HeadersInit,
): NextRequest {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const absolute = url.startsWith("http") ? url : `${base}${url}`;
  const headers = new Headers({
    origin: base,
    "sec-fetch-site": "same-origin",
    ...extraHeaders,
  });
  return new NextRequest(absolute, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function seedUser(opts: { username?: string; role?: Role } = {}) {
  return db.user.create({
    data: {
      username: opts.username ?? `user-${randomUUID().slice(0, 8)}`,
      passwordHash: "x",
      role: opts.role ?? "PAYER",
    },
  });
}

export async function seedMerchant(
  opts: { businessName?: string; status?: MerchantStatus; accountNumberLast4?: string } = {},
) {
  const user = await db.user.create({
    data: {
      username: `merchant-${randomUUID().slice(0, 8)}`,
      passwordHash: "x",
      role: "MERCHANT",
    },
  });
  const acct = "1234567890";
  const merchant = await db.merchant.create({
    data: {
      userId: user.id,
      businessName: opts.businessName ?? "Test Store",
      status: opts.status ?? "ACTIVE",
      qrphRaw: "QRPHRAW",
      qrphMerchantId: "MID123",
      settlementBankCode: "BPI",
      settlementBankName: "Bank of the Philippine Islands",
      accountName: "Test Store Inc",
      accountNumber: "encrypted",
      accountNumberLast4: opts.accountNumberLast4 ?? acct.slice(-4),
    },
  });
  return { ...merchant, username: user.username };
}

export async function seedPayment(
  opts: {
    status?: PaymentStatus;
    amountPhp?: Decimal | string;
    amountAsset?: Decimal | string;
    netSettledPhp?: Decimal | string;
    failureReason?: string;
    withEvents?: boolean;
  } = {},
) {
  const { user: payer } = await makePayer();
  const { merchant } = await makeMerchant();
  const payment = await db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: payer.id,
      merchantId: merchant.id,
      amountPhp: opts.amountPhp?.toString() ?? "100.00",
      quotedRate: "12.00000000",
      amountAsset: opts.amountAsset?.toString() ?? "8.3333334",
      networkFeeXlm: "0.0000100",
      status: opts.status ?? "SETTLED",
      netSettledPhp: opts.netSettledPhp?.toString() ?? null,
      failureReason: opts.failureReason ?? null,
    },
  });
  if (opts.withEvents) {
    await db.paymentEvent.create({
      data: {
        paymentId: payment.id,
        fromStatus: null,
        toStatus: payment.status,
        createdAt: new Date(Date.now() - 1000),
      },
    });
  }
  return payment;
}
