import "server-only";
import { db } from "@/server/db";
import { dec, type Decimal } from "@/lib/money";
import { displayAsset, displayPhp } from "@/lib/money";
import { enabledAssets, type PaymentAsset } from "@/lib/assets";
import { isAssetConfigured } from "@/server/stellar/assets";
import { getAssetBalances, type WalletAssetBalance } from "@/server/wallet/balances";
import type { PaymentStatus } from "@/generated/prisma/client";

export type WalletSummary = {
  publicKey: string;
  balanceXlm: Decimal;
  reservedXlm: Decimal;
  availableXlm: Decimal;
  /** Every enabled, issuer-configured asset, XLM first. */
  balances: WalletAssetBalance[];
};

export async function getWalletSummary(payerId: string): Promise<WalletSummary | null> {
  const wallet = await db.custodialWallet.findUnique({ where: { userId: payerId } });
  if (!wallet) return null;
  const balances = await getAssetBalances(db, wallet.id, enabledAssets().filter(isAssetConfigured));
  const xlm = balances.find((b) => b.asset === "XLM");
  return {
    publicKey: wallet.stellarPublicKey,
    balanceXlm: xlm?.cached ?? dec("0"),
    reservedXlm: xlm?.reserved ?? dec("0"),
    availableXlm: xlm?.available ?? dec("0"),
    balances,
  };
}

export type RecentPayment = {
  id: string;
  reference: string;
  merchantName: string;
  merchantCity: string | null;
  asset: PaymentAsset;
  amountAsset: Decimal;
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
    asset: p.asset,
    amountAsset: dec(p.amountAsset.toString()),
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
  asset: PaymentAsset;
  amountAsset: string;
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
    asset: p.asset,
    amountAsset: displayAsset(dec(p.amountAsset.toString()), p.asset),
    amountPhp: displayPhp(dec(p.amountPhp.toString())),
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  }));
  return { items, nextCursor: hasMore ? page[page.length - 1]!.id : undefined };
}
