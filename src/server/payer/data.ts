import "server-only";
import { db } from "@/server/db";
import { dec, availableXlm, type Decimal } from "@/lib/money";
import { rail } from "@/server/rails";
import type { PaymentStatus } from "@/generated/prisma";

export type WalletSummary = {
  publicKey: string;
  balanceXlm: Decimal;
  reservedXlm: Decimal;
  availableXlm: Decimal;
  approxPhp: Decimal;
};

export async function getWalletSummary(userId: string): Promise<WalletSummary | null> {
  const w = await db.custodialWallet.findUnique({ where: { userId } });
  if (!w) return null;
  const balance = dec(w.cachedXlmBalance.toString());
  const reserved = dec(w.reservedXlm.toString());
  const available = availableXlm(balance, reserved);
  let approxPhp = dec("0");
  try {
    const q = await rail.getQuote({ sell: "XLM", buy: "PHP", phpAmount: dec("1") });
    approxPhp = available.times(q.rate);
  } catch {
    // Rate unavailable → leave approxPhp at 0 rather than failing the dashboard.
  }
  return {
    publicKey: w.stellarPublicKey,
    balanceXlm: balance,
    reservedXlm: reserved,
    availableXlm: available,
    approxPhp,
  };
}

export type RecentPayment = {
  id: string;
  reference: string;
  merchantName: string;
  amountXlm: Decimal;
  amountPhp: Decimal;
  status: PaymentStatus;
  createdAt: Date;
};

export async function getRecentPayments(payerId: string, limit = 5): Promise<RecentPayment[]> {
  const rows = await db.payment.findMany({
    where: { payerId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { merchant: { select: { businessName: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    reference: p.reference,
    merchantName: p.merchant.businessName,
    amountXlm: dec(p.amountXlm.toString()),
    amountPhp: dec(p.amountPhp.toString()),
    status: p.status,
    createdAt: p.createdAt,
  }));
}
