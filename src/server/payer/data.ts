import "server-only";
import { db } from "@/server/db";
import { dec, type Decimal } from "@/lib/money";
import { displayPhp, displayXlm } from "@/lib/money";
import type { PaymentStatus } from "@/generated/prisma/client";

export type WalletSummary = {
  publicKey: string;
  balanceXlm: Decimal;
  reservedXlm: Decimal;
  availableXlm: Decimal;
};

export async function getWalletSummary(payerId: string): Promise<WalletSummary | null> {
  const wallet = await db.custodialWallet.findUnique({ where: { userId: payerId } });
  if (!wallet) return null;
  const balanceXlm = dec(wallet.cachedXlmBalance.toString());
  const reservedXlm = dec(wallet.reservedXlm.toString());
  return {
    publicKey: wallet.stellarPublicKey,
    balanceXlm,
    reservedXlm,
    availableXlm: balanceXlm.minus(reservedXlm),
  };
}

export type RecentPayment = {
  id: string;
  reference: string;
  merchantName: string;
  merchantCity: string | null;
  amountXlm: Decimal;
  amountPhp: Decimal;
  status: PaymentStatus;
  createdAt: string;
};

export async function getRecentPayments(payerId: string, limit = 5): Promise<RecentPayment[]> {
  const rows = await db.payment.findMany({
    where: { payerId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { merchant: { select: { businessName: true, qrphMerchantCity: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    reference: p.reference,
    merchantName: p.merchant.businessName,
    merchantCity: p.merchant.qrphMerchantCity,
    amountXlm: dec(p.amountXlm.toString()),
    amountPhp: dec(p.amountPhp.toString()),
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  }));
}

export type PayerPaymentListItem = {
  id: string;
  reference: string;
  merchantName: string;
  merchantCity: string | null;
  amountXlm: string;
  amountPhp: string;
  status: PaymentStatus;
  createdAt: string;
};

export async function getPayerPayments(
  payerId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ items: PayerPaymentListItem[]; nextCursor?: string }> {
  const rows = await db.payment.findMany({
    where: { payerId },
    orderBy: { createdAt: "desc" },
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: { merchant: { select: { businessName: true, qrphMerchantCity: true } } },
  });
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  const items = page.map((p) => ({
    id: p.id,
    reference: p.reference,
    merchantName: p.merchant.businessName,
    merchantCity: p.merchant.qrphMerchantCity,
    amountXlm: displayXlm(dec(p.amountXlm.toString())),
    amountPhp: displayPhp(dec(p.amountPhp.toString())),
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  }));
  return { items, nextCursor: hasMore ? page[page.length - 1]!.id : undefined };
}
