import "server-only";
import { prisma } from "@/server/db";
import { PaymentStatus } from "@/generated/prisma/client";
import { dec, Decimal } from "@/lib/money";
import type { PaymentAsset } from "@/lib/assets";
import { enqueueSettle } from "@/server/queue/queues";
import { audit } from "@/server/auth/audit";
import { conflict, notFound } from "@/lib/errors";
import { encodeCursor, decodeCursor, type Page } from "./pagination";

export type AdminPaymentRow = {
  id: string;
  reference: string;
  status: PaymentStatus;
  payerUsername: string;
  merchantName: string;
  amountPhp: Decimal;
  asset: PaymentAsset;
  /** Crypto debited from the payer, denominated in `asset`. */
  amountAsset: Decimal;
  failureReason: string | null;
  createdAt: Date;
};
export type AdminPaymentEvent = {
  id: string;
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus;
  detail: unknown;
  createdAt: Date;
};
export type AdminPaymentDetail = AdminPaymentRow & {
  events: AdminPaymentEvent[];
  stellarTxHash: string | null;
  pdaxTradeRef: string | null;
  pdaxCashoutRef: string | null;
};

const ROW_INCLUDE = {
  payer: { select: { username: true } },
  merchant: { select: { businessName: true } },
} as const;

function toRow(p: {
  id: string;
  reference: string;
  status: PaymentStatus;
  amountPhp: unknown;
  asset: PaymentAsset;
  amountAsset: unknown;
  failureReason: string | null;
  createdAt: Date;
  payer: { username: string };
  merchant: { businessName: string };
}): AdminPaymentRow {
  return {
    id: p.id,
    reference: p.reference,
    status: p.status,
    payerUsername: p.payer.username,
    merchantName: p.merchant.businessName,
    amountPhp: dec(String(p.amountPhp)),
    asset: p.asset,
    amountAsset: dec(String(p.amountAsset)),
    failureReason: p.failureReason,
    createdAt: p.createdAt,
  };
}

export async function listAdminPayments(input: {
  cursor?: string;
  limit: number;
  status?: PaymentStatus;
  q?: string;
}): Promise<Page<AdminPaymentRow>> {
  const filters: Record<string, unknown>[] = [];
  if (input.status) filters.push({ status: input.status });
  if (input.q)
    filters.push({
      OR: [
        { reference: { contains: input.q, mode: "insensitive" } },
        { payer: { username: { contains: input.q, mode: "insensitive" } } },
        { merchant: { businessName: { contains: input.q, mode: "insensitive" } } },
      ],
    });
  const cur = input.cursor ? decodeCursor(input.cursor) : null;
  if (cur)
    filters.push({
      OR: [{ createdAt: { lt: cur.createdAt } }, { createdAt: cur.createdAt, id: { lt: cur.id } }],
    });
  const rows = await prisma.payment.findMany({
    where: filters.length ? { AND: filters } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    include: ROW_INCLUDE,
  });
  const sliced = rows.slice(0, input.limit);
  const items = sliced.map(toRow);
  const nextCursor = rows.length > input.limit ? encodeCursor(sliced[sliced.length - 1]!) : null;
  return { items, nextCursor };
}

export async function getAdminPayment(id: string): Promise<AdminPaymentDetail | null> {
  const p = await prisma.payment.findUnique({
    where: { id },
    include: { ...ROW_INCLUDE, events: { orderBy: { createdAt: "asc" } } },
  });
  if (!p) return null;
  return {
    ...toRow(p),
    stellarTxHash: p.stellarTxHash,
    pdaxTradeRef: p.pdaxTradeRef,
    pdaxCashoutRef: p.pdaxCashoutRef,
    events: p.events.map((e) => ({
      id: e.id,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      detail: e.detail,
      createdAt: e.createdAt,
    })),
  };
}

// Statuses from which a retry makes no sense (already done / refund track).
const NON_RETRYABLE: PaymentStatus[] = ["SETTLED", "REFUND_PENDING", "REFUNDED"];

export async function retryPayment(input: {
  id: string;
  actorId: string;
  ip?: string;
}): Promise<{ id: string; status: PaymentStatus }> {
  const p = await prisma.payment.findUnique({
    where: { id: input.id },
    select: { id: true, status: true },
  });
  if (!p) throw notFound("Payment not found");
  if (NON_RETRYABLE.includes(p.status)) {
    throw conflict(`Cannot retry a ${p.status} payment`, { status: p.status });
  }
  await prisma.paymentEvent.create({
    data: {
      paymentId: p.id,
      fromStatus: p.status,
      toStatus: p.status,
      detail: { action: "admin.retry", actorId: input.actorId },
    },
  });
  await enqueueSettle(p.id);
  await audit({
    actorId: input.actorId,
    action: "admin.payment.retry",
    target: p.id,
    metadata: { fromStatus: p.status },
    ip: input.ip,
  });
  return { id: p.id, status: p.status };
}

// Refund only makes sense once XLM has actually left the custodial wallet (>= STELLAR_SUBMITTED)
// and the payment has not already reached a terminal refund/settled state.
const REFUNDABLE: PaymentStatus[] = [
  "STELLAR_SUBMITTED",
  "STELLAR_CONFIRMED",
  "PDAX_TRADING",
  "PDAX_TRADED",
  "PAYOUT_SUBMITTED",
  "FAILED",
];

export async function refundPayment(input: {
  id: string;
  actorId: string;
  ip?: string;
}): Promise<{ id: string; status: PaymentStatus }> {
  const p = await prisma.payment.findUnique({
    where: { id: input.id },
    select: { id: true, status: true },
  });
  if (!p) throw notFound("Payment not found");
  if (!REFUNDABLE.includes(p.status)) {
    throw conflict(`Cannot refund a ${p.status} payment`, { status: p.status });
  }
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: p.id },
      data: { status: "REFUND_PENDING", failureReason: "Admin-initiated refund" },
    }),
    prisma.paymentEvent.create({
      data: {
        paymentId: p.id,
        fromStatus: p.status,
        toStatus: "REFUND_PENDING",
        detail: { action: "admin.refund", actorId: input.actorId },
      },
    }),
  ]);
  await enqueueSettle(p.id);
  await audit({
    actorId: input.actorId,
    action: "admin.payment.refund",
    target: p.id,
    metadata: { fromStatus: p.status },
    ip: input.ip,
  });
  return { id: p.id, status: "REFUND_PENDING" };
}
