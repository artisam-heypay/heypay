import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { encryptSecret } from "@/server/crypto/envelope";
import type { User, CustodialWallet, Merchant, MerchantStatus } from "@/generated/prisma/client";

// Re-export the Prisma client under the `prisma` name for helpers/tests that expect it.
export { db as prisma } from "@/server/db";

export async function resetDb(): Promise<void> {
  // Order respects FK constraints (children first).
  await db.paymentEvent.deleteMany();
  await db.walletTransaction.deleteMany();
  await db.payment.deleteMany();
  await db.idempotencyKey.deleteMany();
  await db.exchangeRateSnapshot.deleteMany();
  await db.auditLog.deleteMany();
  await db.merchant.deleteMany();
  await db.walletBalance.deleteMany();
  await db.custodialWallet.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
}

export async function makePayer(opts?: {
  cachedXlm?: string;
  reservedXlm?: string;
  /** Issued-asset balances, e.g. `{ USDT: { cached: "50.0000000" } }`. Trusted unless said otherwise. */
  assets?: Partial<
    Record<"USDC" | "USDT", { cached?: string; reserved?: string; trustline?: boolean }>
  >;
}): Promise<{ user: User; wallet: CustodialWallet }> {
  const user = await db.user.create({
    data: { username: `payer-${randomUUID()}`, passwordHash: "x", role: "PAYER" },
  });
  const wallet = await db.custodialWallet.create({
    data: {
      userId: user.id,
      stellarPublicKey: `G${randomUUID().replace(/-/g, "").toUpperCase()}`,
      encryptedSecret: encryptSecret(`S${randomUUID().replace(/-/g, "").toUpperCase()}`),
      cachedXlmBalance: opts?.cachedXlm ?? "1000.0000000",
      reservedXlm: opts?.reservedXlm ?? "0.0000000",
    },
  });
  for (const [asset, cfg] of Object.entries(opts?.assets ?? {})) {
    await db.walletBalance.create({
      data: {
        walletId: wallet.id,
        asset: asset as "USDC" | "USDT",
        cached: cfg.cached ?? "0.0000000",
        reserved: cfg.reserved ?? "0.0000000",
        trustlineEstablishedAt: cfg.trustline === false ? null : new Date(),
      },
    });
  }
  return { user, wallet };
}

export async function makeMerchant(opts?: {
  status?: MerchantStatus;
  accountNumber?: string;
}): Promise<{ user: User; merchant: Merchant }> {
  const user = await db.user.create({
    data: { username: `merchant-${randomUUID()}`, passwordHash: "x", role: "MERCHANT" },
  });
  const acct = opts?.accountNumber ?? "1234567890";
  const merchant = await db.merchant.create({
    data: {
      userId: user.id,
      businessName: "Test Store",
      status: opts?.status ?? "ACTIVE",
      qrphRaw: "QRPHRAW",
      qrphMerchantId: "MID123",
      settlementBankCode: "BPI",
      settlementBankName: "Bank of the Philippine Islands",
      accountName: "Test Store Inc",
      accountNumber: encryptSecret(acct),
      accountNumberLast4: acct.slice(-4),
    },
  });
  return { user, merchant };
}
