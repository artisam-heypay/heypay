// src/server/payments/state-machine.ts
import "server-only";
import { PaymentStatus, type Payment, type Prisma } from "@/generated/prisma/client";
import { conflict } from "@/lib/errors";
import { Decimal } from "@/lib/money";
import { prisma } from "@/server/db";

export type TxClient = Prisma.TransactionClient;

const S = PaymentStatus;

export const TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [S.CREATED]: [S.QUOTED, S.FAILED],
  [S.QUOTED]: [S.AUTHORIZED, S.FAILED],
  [S.AUTHORIZED]: [S.STELLAR_SUBMITTED, S.FAILED],
  // submitted-but-unconfirmed: confirm step decides CONFIRMED vs FAILED (tx never landed)
  [S.STELLAR_SUBMITTED]: [S.STELLAR_CONFIRMED, S.FAILED],
  // from here on XLM has left the wallet → failures branch to REFUND_PENDING
  [S.STELLAR_CONFIRMED]: [S.PDAX_TRADING, S.REFUND_PENDING],
  [S.PDAX_TRADING]: [S.PDAX_TRADED, S.REFUND_PENDING],
  [S.PDAX_TRADED]: [S.PAYOUT_SUBMITTED, S.REFUND_PENDING],
  [S.PAYOUT_SUBMITTED]: [S.SETTLED, S.REFUND_PENDING],
  [S.REFUND_PENDING]: [S.REFUNDED, S.FAILED],
  [S.SETTLED]: [],
  [S.FAILED]: [],
  [S.REFUNDED]: [],
};

export const TERMINAL: ReadonlySet<PaymentStatus> = new Set([S.SETTLED, S.FAILED, S.REFUNDED]);
export const XLM_MOVED: ReadonlySet<PaymentStatus> = new Set([
  S.STELLAR_CONFIRMED,
  S.PDAX_TRADING,
  S.PDAX_TRADED,
  S.PAYOUT_SUBMITTED,
]);

const NEXT: Partial<Record<PaymentStatus, PaymentStatus>> = {
  [S.CREATED]: S.QUOTED,
  [S.QUOTED]: S.AUTHORIZED,
  [S.AUTHORIZED]: S.STELLAR_SUBMITTED,
  [S.STELLAR_SUBMITTED]: S.STELLAR_CONFIRMED,
  [S.STELLAR_CONFIRMED]: S.PDAX_TRADING,
  [S.PDAX_TRADING]: S.PDAX_TRADED,
  [S.PDAX_TRADED]: S.PAYOUT_SUBMITTED,
  [S.PAYOUT_SUBMITTED]: S.SETTLED,
  [S.REFUND_PENDING]: S.REFUNDED,
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: PaymentStatus): boolean {
  return TERMINAL.has(status);
}

export function nextStep(status: PaymentStatus): PaymentStatus | null {
  return NEXT[status] ?? null;
}

export async function applyTransition(
  client: TxClient,
  payment: { id: string; status: PaymentStatus },
  toStatus: PaymentStatus,
  detail?: Prisma.InputJsonValue,
): Promise<Payment> {
  if (!canTransition(payment.status, toStatus)) {
    throw conflict(`illegal transition ${payment.status} -> ${toStatus}`);
  }
  const updated = await client.payment.update({
    where: { id: payment.id },
    data: { status: toStatus },
  });
  await client.paymentEvent.create({
    data: {
      paymentId: payment.id,
      fromStatus: payment.status,
      toStatus,
      detail: detail ?? undefined,
    },
  });
  return updated;
}

const RAIL_STATUS_MAP: Record<
  "trade" | "cashout",
  Record<"PENDING" | "FILLED" | "SETTLED" | "FAILED", PaymentStatus>
> = {
  trade: {
    PENDING: "PDAX_TRADING",
    FILLED: "PDAX_TRADED",
    SETTLED: "SETTLED",
    FAILED: "FAILED",
  },
  cashout: {
    PENDING: "PAYOUT_SUBMITTED",
    FILLED: "PAYOUT_SUBMITTED",
    SETTLED: "SETTLED",
    FAILED: "FAILED",
  },
};

/**
 * Idempotent advancer used by the PDAX webhook (and polling fallback) to push a
 * payment forward from an external rail callback. Replaying the same callback is
 * a no-op at the data layer.
 */
export async function advanceOnRailCallback(input: {
  paymentId: string;
  kind: "trade" | "cashout";
  externalRef: string;
  state: "PENDING" | "FILLED" | "SETTLED" | "FAILED";
  feePhp?: Decimal;
  netPhp?: Decimal;
}): Promise<{ status: PaymentStatus }> {
  const toStatus = RAIL_STATUS_MAP[input.kind][input.state];

  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    select: { status: true },
  });
  if (!payment) throw new Error(`Payment not found: ${input.paymentId}`);

  const data: Prisma.PaymentUpdateInput = { status: toStatus };
  if (input.kind === "trade" && input.state !== "PENDING") {
    if (input.feePhp !== undefined) data.pdaxFeePhp = input.feePhp;
    if (input.netPhp !== undefined) data.netSettledPhp = input.netPhp;
  }
  if (toStatus === "SETTLED") {
    data.settledAt = new Date();
  }

  const updated = await prisma.payment.update({ where: { id: input.paymentId }, data });

  await prisma.paymentEvent.create({
    data: {
      paymentId: input.paymentId,
      fromStatus: payment.status,
      toStatus,
      detail: {
        kind: input.kind,
        externalRef: input.externalRef,
        feePhp: input.feePhp?.toString(),
        netPhp: input.netPhp?.toString(),
      },
    },
  });

  return { status: updated.status };
}
