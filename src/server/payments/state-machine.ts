// src/server/payments/state-machine.ts
import "server-only";
import { PaymentStatus, type Payment, type Prisma } from "@/generated/prisma/client";
import { conflict } from "@/lib/errors";

export type TxClient = Prisma.TransactionClient;

const S = PaymentStatus;

export const TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [S.CREATED]: [S.QUOTED, S.FAILED],
  [S.QUOTED]: [S.AUTHORIZED, S.FAILED],
  [S.AUTHORIZED]: [S.STELLAR_SUBMITTED, S.FAILED],
  // submitted-but-unconfirmed: confirm step decides CONFIRMED vs FAILED (tx never landed)
  [S.STELLAR_SUBMITTED]: [S.STELLAR_CONFIRMED, S.FAILED],
  // from here on the crypto has left the wallet → failures branch to REFUND_PENDING
  [S.STELLAR_CONFIRMED]: [S.PAYOUT_SUBMITTED, S.REFUND_PENDING],
  // Legacy PDAX states: never entered any more, so nothing leaves them either.
  [S.PDAX_TRADING]: [],
  [S.PDAX_TRADED]: [],
  [S.PAYOUT_SUBMITTED]: [S.SETTLED, S.REFUND_PENDING],
  [S.REFUND_PENDING]: [S.REFUNDED, S.FAILED],
  [S.SETTLED]: [],
  [S.FAILED]: [],
  [S.REFUNDED]: [],
};

export const TERMINAL: ReadonlySet<PaymentStatus> = new Set([S.SETTLED, S.FAILED, S.REFUNDED]);
export const XLM_MOVED: ReadonlySet<PaymentStatus> = new Set([
  S.STELLAR_CONFIRMED,
  S.PAYOUT_SUBMITTED,
]);

const NEXT: Partial<Record<PaymentStatus, PaymentStatus>> = {
  [S.CREATED]: S.QUOTED,
  [S.QUOTED]: S.AUTHORIZED,
  [S.AUTHORIZED]: S.STELLAR_SUBMITTED,
  [S.STELLAR_SUBMITTED]: S.STELLAR_CONFIRMED,
  [S.STELLAR_CONFIRMED]: S.PAYOUT_SUBMITTED,
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
