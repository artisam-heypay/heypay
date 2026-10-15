// src/server/payments/escrow-self-refund.ts
//
// The payer's own way out of the escrow: once a held job's deadline ledger has
// passed, the payer's custodial wallet calls the contract's
// `refund_after_timeout` and takes the crypto back, without the admin.
//
// The app offers it only when the merchant will not be paid for the same
// payment: the payout was never requested, was stopped, or has failed. A payout
// the bank is still working on cannot be recalled, and refunding the payer
// while it may still be paid would settle the purchase twice, so such a payment
// waits for the payout's result however long that takes.
import "server-only";
import { PaymentStatus, type Payment } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { conflict, forbidden, notFound } from "@/lib/errors";
import type { Decimal } from "@/lib/money";
import { audit } from "@/server/auth/audit";
import { captureException } from "@/server/observability/error-tracking";
import { captureUserEvent } from "@/server/observability/analytics";
import {
  creditRefundEntry,
  debitRefundFee,
  ESCROW_EXPIRED_DETAIL,
  ESCROW_EXPIRED_REASON,
  ESCROW_REFUND_RECLAIM_MS,
} from "@/server/queue/jobs/settle";
import { enqueueSettle } from "@/server/queue/queues";
import { rail } from "@/server/rails";
import { applyTransition } from "@/server/payments/state-machine";
import {
  escrowFor,
  EscrowContractError,
  EscrowTxFailedError,
  type EscrowService,
} from "@/server/stellar/escrow";

/** About how long a Stellar ledger takes to close. */
const SECONDS_PER_LEDGER = 5;

// The crypto is in the escrow and already debited from the payer's balance.
const SELF_REFUNDABLE: ReadonlySet<PaymentStatus> = new Set([
  PaymentStatus.STELLAR_CONFIRMED,
  PaymentStatus.PAYOUT_SUBMITTED,
  PaymentStatus.REFUND_PENDING,
]);

const PAYOUT_IN_PROGRESS =
  "The bank transfer to the merchant is already on its way and can't be stopped. " +
  "If it fails, your payment is refunded automatically.";

export type EscrowSelfRefundState = {
  /** The deadline has passed and no payout can be paid: the payer can refund now. */
  available: boolean;
  /** Roughly how long until the deadline; 0 once it has passed. */
  secondsUntilAvailable: number;
  /**
   * The deadline has passed, but the payout is with the bank and cannot be
   * stopped: the payer has to wait for its result.
   */
  waitingOnPayout: boolean;
};

function holdsEscrow(p: Pick<Payment, "status" | "escrowJobId" | "refundTxHash">): boolean {
  return Boolean(p.escrowJobId) && !p.refundTxHash && SELF_REFUNDABLE.has(p.status);
}

/** Seconds until the held job can be self-refunded, or null when it is not held. */
async function secondsUntilRefundable(
  escrow: EscrowService,
  jobId: Buffer,
): Promise<number | null> {
  const job = await escrow.getJob(jobId);
  if (job?.status !== "Held") return null;
  const ledgersLeft = job.deadlineLedger - (await escrow.getLatestLedger());
  return Math.max(0, ledgersLeft) * SECONDS_PER_LEDGER;
}

/**
 * Whether the payer can refund this payment from the escrow, for the payment
 * detail view. Null when nothing of it is held there, when its payout has just
 * been paid, and when the contract or the rail cannot be read: the view must
 * still load.
 */
export async function escrowSelfRefundState(
  p: Pick<
    Payment,
    "id" | "asset" | "status" | "escrowJobId" | "refundTxHash" | "payoutRef" | "payoutRequestedAt"
  >,
): Promise<EscrowSelfRefundState | null> {
  if (!holdsEscrow(p)) return null;
  try {
    const seconds = await secondsUntilRefundable(
      escrowFor(p.asset),
      Buffer.from(p.escrowJobId!, "hex"),
    );
    if (seconds === null) return null;
    // A refund HeyPay is already sending needs no countdown to the payer's own.
    if (seconds > 0 && p.status === PaymentStatus.REFUND_PENDING) return null;
    if (seconds === 0 && (p.payoutRequestedAt || p.payoutRef)) {
      const waiting = { available: false, secondsUntilAvailable: 0, waitingOnPayout: true };
      // A request started but not recorded yet: the rail may hold a payout.
      if (!p.payoutRef) return waiting;
      const payout = await rail.getPayoutStatus(p.payoutRef);
      if (payout.state === "SETTLED") return null; // about to be completed
      if (payout.state === "PENDING") return waiting;
    }
    return { available: seconds === 0, secondsUntilAvailable: seconds, waitingOnPayout: false };
  } catch (err) {
    captureException(err, { source: "escrow.self_refund_state", paymentId: p.id });
    return null;
  }
}

/**
 * Refunds a held payment from the escrow to its payer, signed by the payer's
 * wallet, and credits their balance. Only the payer starts this; HeyPay never
 * does it for them. The payment then moves to REFUND_PENDING and the settle job
 * closes it as REFUNDED, and checks once more that no payout was paid for it.
 */
export async function selfRefundEscrow(input: {
  id: string;
  payerId: string;
  ip?: string;
}): Promise<{ refundTxHash: string; status: PaymentStatus; failureReason: string | null }> {
  const p = await db.payment.findUnique({
    where: { id: input.id },
    include: { payer: { include: { wallet: true } } },
  });
  if (!p) throw notFound("payment not found");
  if (p.payerId !== input.payerId) throw forbidden("not your payment");
  if (!holdsEscrow(p) || !p.payer.wallet) {
    throw conflict("This payment has nothing held in escrow to refund.");
  }
  const wallet = p.payer.wallet;
  // The instance that holds the payment's asset; it returns that same asset.
  const escrow = escrowFor(p.asset);
  const jobId = Buffer.from(p.escrowJobId!, "hex");

  const seconds = await secondsUntilRefundable(escrow, jobId);
  if (seconds === null) throw conflict("The escrow no longer holds this payment.");
  if (seconds > 0) {
    throw conflict(`The escrow refund opens in about ${seconds} seconds.`, {
      secondsUntilAvailable: seconds,
    });
  }

  // Make sure no payout can be paid for this payment before its crypto goes
  // back. Whatever the payment's status, once a payout request has started the
  // rail has the last word: stopped or failed lets the refund go on; already paid
  // means the payment succeeded, so it is completed instead; anything else (still
  // running, not recorded yet, or the rail cannot say) keeps the payer waiting.
  if (p.payoutRequestedAt || p.payoutRef) {
    if (!p.payoutRef) throw conflict(PAYOUT_IN_PROGRESS, { waitingOnPayout: true });
    const stopped = await rail.cancelPayout(p.payoutRef).catch((err: unknown) => {
      captureException(err, {
        source: "escrow.self_refund",
        paymentId: p.id,
        reference: p.reference,
        step: "payout_cancel",
      });
      return null;
    });
    if (stopped?.state === "SETTLED") {
      await enqueueSettle(p.id);
      throw conflict("The merchant has just been paid, so this payment is being completed.");
    }
    if (stopped?.state !== "FAILED") {
      throw conflict(PAYOUT_IN_PROGRESS, { waitingOnPayout: true });
    }
  }

  // Claim the refund. The same marker is claimed by the settle job's own refund,
  // so the two never run at once; and the claim only succeeds while the payout
  // is exactly as checked above, so a payout request that started in the
  // meantime wins and this refund does not happen.
  const claimed = await db.payment.updateMany({
    where: {
      id: p.id,
      refundTxHash: null,
      payoutRef: p.payoutRef,
      payoutRequestedAt: p.payoutRequestedAt,
      OR: [
        { refundSubmittedAt: null },
        { refundSubmittedAt: { lt: new Date(Date.now() - ESCROW_REFUND_RECLAIM_MS) } },
      ],
    },
    data: { refundSubmittedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw conflict("This payment is being processed right now. Try again in a moment.");
  }

  let txHash: string;
  try {
    ({ txHash } = await escrow.refundAfterTimeout({
      jobId,
      encryptedSecret: wallet.encryptedSecret,
    }));
  } catch (err) {
    // Rejected at simulation or failed on-chain: nothing moved, so the claim is
    // dropped. Anything else may have landed and keeps the marker.
    const nothingMoved =
      err instanceof EscrowContractError ||
      (err instanceof EscrowTxFailedError && err.status === "FAILED");
    if (nothingMoved) {
      await db.payment.update({ where: { id: p.id }, data: { refundSubmittedAt: null } });
    } else {
      captureException(err, {
        source: "escrow.self_refund",
        paymentId: p.id,
        reference: p.reference,
        moneyAtRisk: true,
      });
    }
    if (err instanceof EscrowContractError) {
      throw conflict(`The escrow refused the refund: ${err.code}.`);
    }
    throw err;
  }
  await db.payment.update({ where: { id: p.id }, data: { refundTxHash: txHash } });

  // The payer's wallet paid the Soroban fee for the call; keep the balance in step.
  const fee = await refundFeeCharged(escrow, txHash, p);
  await db.$transaction(async (tx) => {
    const credited = await creditRefundEntry(tx, p, txHash);
    if (credited && fee?.greaterThan(0)) await debitRefundFee(tx, p, fee);
    // A payment already REFUND_PENDING is on its way to REFUNDED as it is.
    if (p.status !== PaymentStatus.REFUND_PENDING) {
      await tx.payment.update({
        where: { id: p.id },
        data: { failureReason: ESCROW_EXPIRED_REASON },
      });
      await applyTransition(tx, p, PaymentStatus.REFUND_PENDING, {
        failureReason: ESCROW_EXPIRED_REASON,
        [ESCROW_EXPIRED_DETAIL]: true,
      });
    }
  });
  await enqueueSettle(p.id); // REFUND_PENDING → REFUNDED

  await audit({
    actorId: input.payerId,
    action: "payment.escrow_self_refund",
    target: p.id,
    metadata: {
      reference: p.reference,
      status: p.status,
      escrowJobId: p.escrowJobId,
      refundTxHash: txHash,
      feeXlm: fee?.toFixed(7),
    },
    ip: input.ip,
  });
  captureUserEvent(
    "payment_escrow_self_refunded",
    { id: input.payerId, role: "PAYER" },
    {
      payment_id: p.id,
      reference: p.reference,
      status: p.status,
      escrow_job_id: p.escrowJobId ?? undefined,
      refund_tx_hash: txHash,
    },
  );
  // What the payment now is, so the caller can show it without waiting for a poll.
  return {
    refundTxHash: txHash,
    status: PaymentStatus.REFUND_PENDING,
    failureReason:
      p.status === PaymentStatus.REFUND_PENDING ? p.failureReason : ESCROW_EXPIRED_REASON,
  };
}

/** The fee the refund charged, or null when it cannot be read. Never throws. */
async function refundFeeCharged(
  escrow: EscrowService,
  txHash: string,
  p: { id: string; reference: string },
): Promise<Decimal | null> {
  try {
    return await escrow.getFeeCharged(txHash);
  } catch (err) {
    captureException(err, {
      source: "escrow.self_refund",
      paymentId: p.id,
      reference: p.reference,
      step: "escrow_fee",
    });
    return null;
  }
}
