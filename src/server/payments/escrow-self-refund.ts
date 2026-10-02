// src/server/payments/escrow-self-refund.ts
//
// The payer's own way out of the escrow: once a held job's deadline ledger has
// passed, the payer's custodial wallet calls the contract's
// `refund_after_timeout` and takes the crypto back, without the admin.
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
import { applyTransition } from "@/server/payments/state-machine";
import { escrowService, EscrowContractError, EscrowTxFailedError } from "@/server/stellar/escrow";

/** About how long a Stellar ledger takes to close. */
const SECONDS_PER_LEDGER = 5;

// The crypto is in the escrow and already debited from the payer's balance.
const SELF_REFUNDABLE: ReadonlySet<PaymentStatus> = new Set([
  PaymentStatus.STELLAR_CONFIRMED,
  PaymentStatus.PAYOUT_SUBMITTED,
  PaymentStatus.REFUND_PENDING,
]);

export type EscrowSelfRefundState = {
  /** The deadline has passed, so the payer can refund now. */
  available: boolean;
  /** Roughly how long until the deadline; 0 once it has passed. */
  secondsUntilAvailable: number;
};

function holdsEscrow(p: Pick<Payment, "status" | "escrowJobId" | "refundTxHash">): boolean {
  return Boolean(p.escrowJobId) && !p.refundTxHash && SELF_REFUNDABLE.has(p.status);
}

/** Seconds until the held job can be self-refunded, or null when it is not held. */
async function secondsUntilRefundable(jobId: Buffer): Promise<number | null> {
  const job = await escrowService.getJob(jobId);
  if (job?.status !== "Held") return null;
  const ledgersLeft = job.deadlineLedger - (await escrowService.getLatestLedger());
  return Math.max(0, ledgersLeft) * SECONDS_PER_LEDGER;
}

/**
 * Whether the payer can refund this payment from the escrow, for the payment
 * detail view. Null when nothing of it is held there, and when the contract
 * cannot be read: the view must still load.
 */
export async function escrowSelfRefundState(
  p: Pick<Payment, "id" | "status" | "escrowJobId" | "refundTxHash">,
): Promise<EscrowSelfRefundState | null> {
  if (!holdsEscrow(p)) return null;
  try {
    const seconds = await secondsUntilRefundable(Buffer.from(p.escrowJobId!, "hex"));
    return seconds === null ? null : { available: seconds === 0, secondsUntilAvailable: seconds };
  } catch (err) {
    captureException(err, { source: "escrow.self_refund_state", paymentId: p.id });
    return null;
  }
}

/**
 * Refunds a held payment from the escrow to its payer, signed by the payer's
 * wallet, and credits their balance. Only the payer starts this; HeyPay never
 * does it for them. The payment then moves to REFUND_PENDING and the settle job
 * closes it as REFUNDED, then checks whether the payout that was already running
 * still paid the merchant.
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
  const jobId = Buffer.from(p.escrowJobId!, "hex");

  const seconds = await secondsUntilRefundable(jobId);
  if (seconds === null) throw conflict("The escrow no longer holds this payment.");
  if (seconds > 0) {
    throw conflict(`The escrow refund opens in about ${seconds} seconds.`, {
      secondsUntilAvailable: seconds,
    });
  }

  // Same marker the settle job's own refund claims, so the two never run at once.
  const claimed = await db.payment.updateMany({
    where: {
      id: p.id,
      refundTxHash: null,
      OR: [
        { refundSubmittedAt: null },
        { refundSubmittedAt: { lt: new Date(Date.now() - ESCROW_REFUND_RECLAIM_MS) } },
      ],
    },
    data: { refundSubmittedAt: new Date() },
  });
  if (claimed.count === 0) throw conflict("A refund for this payment is already in progress.");

  let txHash: string;
  try {
    ({ txHash } = await escrowService.refundAfterTimeout({
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
  const fee = await refundFeeCharged(txHash, p);
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
  txHash: string,
  p: { id: string; reference: string },
): Promise<Decimal | null> {
  try {
    return await escrowService.getFeeCharged(txHash);
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
