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

export type ConfirmContext = {
  payment: {
    id: string;
    reference: string;
    amountPhp: string;
    quotedRate: string;
    amountXlm: string;
    networkFeeXlm: string;
    status: PaymentStatus;
    quoteExpiresAt: string | null;
  };
  merchant: { businessName: string; city: string | null };
  wallet: { publicKey: string; availableXlm: string; approxPhp: string } | null;
};

// Ownership-checked snapshot for the confirm screen (payer must own the payment).
export async function getConfirmContext(
  paymentId: string,
  userId: string,
): Promise<ConfirmContext | null> {
  const p = await db.payment.findUnique({
    where: { id: paymentId },
    include: { merchant: { select: { businessName: true, qrphMerchantCity: true } } },
  });
  if (!p || p.payerId !== userId) return null;
  const wallet = await getWalletSummary(userId);
  return {
    payment: {
      id: p.id,
      reference: p.reference,
      amountPhp: p.amountPhp.toFixed(2),
      quotedRate: p.quotedRate.toFixed(8),
      amountXlm: p.amountXlm.toFixed(7),
      networkFeeXlm: p.networkFeeXlm.toFixed(7),
      status: p.status,
      quoteExpiresAt: p.quoteExpiresAt?.toISOString() ?? null,
    },
    merchant: { businessName: p.merchant.businessName, city: p.merchant.qrphMerchantCity },
    wallet: wallet
      ? {
          publicKey: wallet.publicKey,
          availableXlm: wallet.availableXlm.toFixed(7),
          approxPhp: wallet.approxPhp.toFixed(2),
        }
      : null,
  };
}
