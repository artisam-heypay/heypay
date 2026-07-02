import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { notFound } from "@/lib/errors";
import { dec, formatXlm, formatPhp } from "@/lib/money";
import type { Merchant, Payment, PaymentStatus } from "@/generated/prisma/client";
import { MerchantStatus } from "@/generated/prisma/client";
import type { TxQuery } from "@/lib/schemas/merchant";

export type MerchantDto = {
  id: string;
  businessName: string;
  logoKey: string | null;
  status: MerchantStatus;
  qrphRaw: string;
  qrphMerchantName: string | null;
  qrphMerchantCity: string | null;
  qrphMerchantId: string | null;
  qrphImageKey: string | null;
  qrphCountry: string | null;
  qrphCurrency: string | null;
  settlementBankCode: string;
  settlementBankName: string;
  accountName: string;
  accountNumberLast4: string;
  createdAt: string;
  updatedAt: string;
};
export type SetupState = {
  hasBusiness: boolean;
  hasSettlement: boolean;
  hasQrph: boolean;
  isComplete: boolean;
};
export type MerchantTxItem = {
  id: string;
  reference: string;
  customer: string;
  amountXlm: string;
  amountPhp: string;
  netSettledPhp: string | null;
  status: PaymentStatus;
  createdAt: string;
};
export type MerchantTxPage = { items: MerchantTxItem[]; nextCursor: string | null };
export type MerchantEarnings = {
  totalSettledPhp: string;
  momChangePct: number | null;
  pendingXlm: string;
};

/** Non-terminal in-flight states whose XLM is "pending" (post-authorization, pre-settlement). */
export const PENDING_STATUSES: PaymentStatus[] = [
  "AUTHORIZED",
  "STELLAR_SUBMITTED",
  "STELLAR_CONFIRMED",
  "PDAX_TRADING",
  "PDAX_TRADED",
  "PAYOUT_SUBMITTED",
];

export function serializeMerchant(m: Merchant): MerchantDto {
  return {
    id: m.id,
    businessName: m.businessName,
    logoKey: m.logoKey,
    status: m.status,
    qrphRaw: m.qrphRaw,
    qrphMerchantName: m.qrphMerchantName,
    qrphMerchantCity: m.qrphMerchantCity,
    qrphMerchantId: m.qrphMerchantId,
    qrphImageKey: m.qrphImageKey,
    qrphCountry: m.qrphCountry,
    qrphCurrency: m.qrphCurrency,
    settlementBankCode: m.settlementBankCode,
    settlementBankName: m.settlementBankName,
    accountName: m.accountName,
    accountNumberLast4: m.accountNumberLast4,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export function merchantSetupState(m: Merchant): SetupState {
  const hasBusiness = m.businessName.trim().length > 0;
  const hasSettlement = m.settlementBankCode.length > 0 && m.accountNumberLast4.length > 0;
  const hasQrph = m.qrphRaw.length > 0;
  return {
    hasBusiness,
    hasSettlement,
    hasQrph,
    isComplete: hasBusiness && hasSettlement && hasQrph,
  };
}

export function getMerchantForUserOrNull(userId: string): Promise<Merchant | null> {
  return prisma.merchant.findUnique({ where: { userId } });
}

export async function getMerchantForUser(userId: string): Promise<Merchant> {
  const m = await getMerchantForUserOrNull(userId);
  if (!m) throw notFound("Merchant profile not found");
  return m;
}

/** For Server Components: redirect to onboarding instead of rendering a 404. */
export async function requireMerchant(userId: string): Promise<Merchant> {
  const m = await getMerchantForUserOrNull(userId);
  if (!m) redirect("/merchant/onboarding");
  return m;
}

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function getMerchantEarnings(merchantId: string): Promise<MerchantEarnings> {
  const settled = await prisma.payment.findMany({
    where: { merchantId, status: "SETTLED" },
    select: { netSettledPhp: true, settledAt: true },
  });
  const pending = await prisma.payment.findMany({
    where: { merchantId, status: { in: PENDING_STATUSES } },
    select: { amountXlm: true },
  });

  let total = dec(0),
    thisMonth = dec(0),
    lastMonth = dec(0);
  const now = new Date();
  const curStart = monthStart(now);
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  for (const p of settled) {
    const v = dec(p.netSettledPhp?.toString() ?? "0");
    total = total.plus(v);
    const at = p.settledAt ?? undefined;
    if (at && at >= curStart) thisMonth = thisMonth.plus(v);
    else if (at && at >= prevStart && at < curStart) lastMonth = lastMonth.plus(v);
  }
  let pendingXlm = dec(0);
  for (const p of pending) pendingXlm = pendingXlm.plus(dec(p.amountXlm.toString()));

  const momChangePct = lastMonth.isZero()
    ? null
    : Number(
        thisMonth.minus(lastMonth).dividedBy(lastMonth).times(100).toDecimalPlaces(1).toString(),
      );

  return {
    totalSettledPhp: formatPhp(total),
    momChangePct,
    pendingXlm: formatXlm(pendingXlm),
  };
}

function mapTx(p: Payment & { payer: { username: string } }): MerchantTxItem {
  return {
    id: p.id,
    reference: p.reference,
    customer: p.payer.username,
    amountXlm: formatXlm(dec(p.amountXlm.toString())),
    amountPhp: formatPhp(dec(p.amountPhp.toString())),
    netSettledPhp: p.netSettledPhp ? formatPhp(dec(p.netSettledPhp.toString())) : null,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  };
}

function txWhere(merchantId: string, q: Pick<TxQuery, "status" | "from" | "to">) {
  return {
    merchantId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.from || q.to
      ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
      : {}),
  };
}

export async function listMerchantTransactions(
  merchantId: string,
  q: TxQuery,
): Promise<MerchantTxPage> {
  const take = q.limit + 1;
  const rows = await prisma.payment.findMany({
    where: txWhere(merchantId, q),
    include: { payer: { select: { username: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    take,
  });
  const hasMore = rows.length === take;
  const items = (hasMore ? rows.slice(0, q.limit) : rows).map(mapTx);
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export async function allMerchantTransactions(
  merchantId: string,
  q: Pick<TxQuery, "status" | "from" | "to">,
): Promise<MerchantTxItem[]> {
  const rows = await prisma.payment.findMany({
    where: txWhere(merchantId, q),
    include: { payer: { select: { username: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(mapTx);
}
