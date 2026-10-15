// src/server/payments/state-machine.ts
import "server-only";
import { PaymentStatus, type Payment, type Prisma } from "@/generated/prisma/client";
import { AppError, conflict } from "@/lib/errors";
import { analyticsEnabled, captureUserEvent } from "@/server/observability/analytics";
import { assetContract } from "@/server/observability/payment-trail";

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

/**
 * Whether `err` is applyTransition refusing a payment that another caller moved
 * after this one read it. The other caller's move stands; this one changed nothing.
 */
export function isStatusChanged(err: unknown): boolean {
  return (
    err instanceof AppError &&
    (err.details as { reason?: unknown } | undefined)?.reason === "status_changed"
  );
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
  // Moves the payment only while it is still in the status the caller read. Two
  // requests that read the same payment (a cancel and a signed deposit, say)
  // cannot both move it: the second finds the status changed and is refused,
  // and its transaction, with whatever it wrote before this, is rolled back.
  const moved = await client.payment.updateMany({
    where: { id: payment.id, status: payment.status },
    data: { status: toStatus },
  });
  if (moved.count === 0) {
    throw conflict("This payment has already moved on, so nothing was changed.", {
      reason: "status_changed",
      expected: payment.status,
    });
  }
  const updated = await client.payment.findUniqueOrThrow({ where: { id: payment.id } });
  await client.paymentEvent.create({
    data: {
      paymentId: payment.id,
      fromStatus: payment.status,
      toStatus,
      detail: detail ?? undefined,
    },
  });
  // Every status change passes through here, so these two events are the whole
  // payment funnel, once from the payer's side and once from the merchant's.
  // They are sent before the surrounding transaction commits; a rollback (rare)
  // leaves an extra event, and payment_event stays the record.
  if (analyticsEnabled()) {
    // Analytics must never fail the transition, so a failed lookup is ignored.
    const wallet = await client.custodialWallet
      .findUnique({ where: { userId: updated.payerId }, select: { stellarPublicKey: true } })
      .catch(() => null);
    const props = {
      payment_id: updated.id,
      reference: updated.reference,
      merchant_id: updated.merchantId,
      from_status: payment.status,
      to_status: toStatus,
      asset: updated.asset,
      ...assetContract(updated.asset),
      amount_php: Number(updated.amountPhp),
      // The payer's own account when they signed the deposit themselves.
      payer_wallet_address: updated.externalPublicKey ?? wallet?.stellarPublicKey,
      stellar_tx_hash: updated.stellarTxHash,
      payout_ref: updated.payoutRef,
      refund_tx_hash: updated.refundTxHash,
      failure_reason: failureReason(detail),
    };
    captureUserEvent("payment_status_changed", { id: updated.payerId, role: "PAYER" }, props);
    const merchant = await client.merchant
      .findUnique({ where: { id: updated.merchantId }, select: { userId: true } })
      .catch(() => null);
    if (merchant) {
      captureUserEvent(
        "merchant_payment_status_changed",
        { id: merchant.userId, role: "MERCHANT" },
        props,
      );
    }
  }
  return updated;
}

/** The reason a payment failed or is being refunded, if the transition says. */
function failureReason(detail?: Prisma.InputJsonValue): string | undefined {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return undefined;
  const d = detail as Record<string, unknown>;
  const reason = d.failureReason ?? d.reason;
  return typeof reason === "string" ? reason.slice(0, 200) : undefined;
}
