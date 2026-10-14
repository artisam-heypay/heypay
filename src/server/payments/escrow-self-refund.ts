// src/server/payments/escrow-self-refund.ts
//
// The payer's own way out of the escrow: once a held job's deadline ledger has
// passed, the account the deposit came from calls the contract's
// `refund_after_timeout` and takes the crypto back, without the admin. For a
// payment paid from the HeyPay wallet that account is the payer's custodial
// wallet, and HeyPay signs the call for them. For a payment the payer signed
// with their own wallet it is their own account: HeyPay holds no key to it, so
// the payer signs the call in that wallet and HeyPay checks and sends it.
//
// The app offers it only when the merchant will not be paid for the same
// payment: the payout was never requested, was stopped, or has failed. A payout
// the bank is still working on cannot be recalled, and refunding the payer
// while it may still be paid would settle the purchase twice, so such a payment
// waits for the payout's result however long that takes.
import "server-only";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { PaymentStatus, type Payment } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import type { Decimal } from "@/lib/money";
import type { EscrowTimeoutRefundInstructions } from "@/lib/client/escrow-timeout-refund";
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
import { applyTransition, type TxClient } from "@/server/payments/state-machine";
import {
  awaitSentTransaction,
  escrowFor,
  EscrowContractError,
  EscrowTxFailedError,
  type EscrowService,
  type SentTransactionResult,
} from "@/server/stellar/escrow";
import { escrowContractId } from "@/server/stellar/escrow-config";
import { getNetworkPassphrase, isMainnet } from "@/server/stellar/horizon";
import { nonCustodialEnabled } from "@/server/wallet/external";
import { DEPOSIT_VALID_SECONDS } from "./prepare";
import {
  CLOCK_SLACK_SECONDS,
  readSignedTransaction,
  sendSigned,
  shortAddress,
  signedCallFault,
} from "./signed-call";

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

/** The payer's own wallet, as the screen that asks Freighter to sign needs it. */
export type OwnWalletSigner = {
  /** The account the deposit came from; the refund is signed by it and paid to it. */
  address: string;
  /** The network HeyPay runs on; Freighter must be on the same one. */
  networkPassphrase: string;
  networkName: string;
};

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
  /**
   * Set when the deposit came from the payer's own wallet. Only that account
   * can take it back, so the payer signs the refund there and HeyPay signs
   * nothing.
   */
  ownWallet?: OwnWalletSigner;
};

type EscrowedPayment = Pick<
  Payment,
  "status" | "escrowJobId" | "refundTxHash" | "externalPublicKey"
>;

/** Whether the escrow may still hold something of the payment for its payer to take back. */
function inEscrow(p: EscrowedPayment): boolean {
  return Boolean(p.escrowJobId) && !p.refundTxHash && SELF_REFUNDABLE.has(p.status);
}

/**
 * Whether the payer's HeyPay wallet has something in the escrow to take back.
 * A deposit the payer signed with their own wallet is not that: only the
 * account it came from can call `refund_after_timeout` for it, and HeyPay holds
 * no key to that account and no balance to credit.
 */
function holdsEscrow(p: EscrowedPayment): boolean {
  return inEscrow(p) && !p.externalPublicKey;
}

/**
 * The account a payment's deposit came from when the payer signed it with their
 * own wallet and the escrow may still hold it, or null.
 */
function ownDeposit(p: EscrowedPayment): string | null {
  return inEscrow(p) ? p.externalPublicKey : null;
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

type StatePayment = Pick<
  Payment,
  | "id"
  | "asset"
  | "status"
  | "escrowJobId"
  | "refundTxHash"
  | "payoutRef"
  | "payoutRequestedAt"
  | "externalPublicKey"
>;

/**
 * Whether the payer can refund this payment from the escrow, for the payment
 * detail view. Null when nothing of it is held there, when its payout has just
 * been paid, and when the contract or the rail cannot be read: the view must
 * still load.
 *
 * A deposit from the payer's own wallet is offered only while own wallets are
 * (NONCUSTODIAL_ENABLED): the payer's browser builds the refund, and may reach
 * the network only then.
 */
export async function escrowSelfRefundState(
  p: StatePayment,
): Promise<EscrowSelfRefundState | null> {
  if (!inEscrow(p)) return null;
  if (p.externalPublicKey && !nonCustodialEnabled()) return null;
  try {
    const state = await refundState(p);
    if (!state || !p.externalPublicKey) return state;
    return {
      ...state,
      ownWallet: {
        address: p.externalPublicKey,
        networkPassphrase: getNetworkPassphrase(),
        networkName: isMainnet() ? "Mainnet" : "Testnet",
      },
    };
  } catch (err) {
    captureException(err, { source: "escrow.self_refund_state", paymentId: p.id });
    return null;
  }
}

async function refundState(p: StatePayment): Promise<EscrowSelfRefundState | null> {
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
}

/** Refuses unless the escrow still holds the job and its deadline has passed. */
async function assertRefundOpen(escrow: EscrowService, jobId: Buffer): Promise<void> {
  const seconds = await secondsUntilRefundable(escrow, jobId);
  if (seconds === null) throw conflict("The escrow no longer holds this payment.");
  if (seconds > 0) {
    throw conflict(`The escrow refund opens in about ${seconds} seconds.`, {
      secondsUntilAvailable: seconds,
    });
  }
}

type ClaimablePayment = Pick<Payment, "id" | "reference" | "payoutRef" | "payoutRequestedAt">;

/**
 * Makes sure no payout can be paid for this payment before its crypto goes
 * back. Whatever the payment's status, once a payout request has started the
 * rail has the last word: stopped or failed lets the refund go on; already paid
 * means the payment succeeded, so it is completed instead; anything else (still
 * running, not recorded yet, or the rail cannot say) keeps the payer waiting.
 */
async function stopPayout(p: ClaimablePayment): Promise<void> {
  if (!p.payoutRequestedAt && !p.payoutRef) return;
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

/**
 * Claims the refund. The same marker is claimed by the settle job's own refund,
 * so the two never run at once; and the claim only succeeds while the payout is
 * exactly as `stopPayout` saw it, so a payout request that started in the
 * meantime wins and this refund does not happen.
 */
async function claimRefund(p: ClaimablePayment): Promise<void> {
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
}

/** Drops a claim whose refund moved nothing, so the next attempt need not wait. */
async function dropClaim(paymentId: string): Promise<void> {
  await db.payment.update({ where: { id: paymentId }, data: { refundSubmittedAt: null } });
}

/**
 * Moves a payment its payer took back to REFUND_PENDING, marked as expired. One
 * already there is on its way to REFUNDED as it is.
 */
async function markTakenBack(tx: TxClient, p: Pick<Payment, "id" | "status">): Promise<void> {
  if (p.status === PaymentStatus.REFUND_PENDING) return;
  await tx.payment.update({ where: { id: p.id }, data: { failureReason: ESCROW_EXPIRED_REASON } });
  await applyTransition(tx, p, PaymentStatus.REFUND_PENDING, {
    failureReason: ESCROW_EXPIRED_REASON,
    [ESCROW_EXPIRED_DETAIL]: true,
  });
}

/** What the payment became once its payer took it back, for the screen that asked. */
export type SelfRefundResult = {
  refundTxHash: string;
  status: PaymentStatus;
  failureReason: string | null;
};

/**
 * Refunds a held payment from the escrow to its payer, signed by the payer's
 * HeyPay wallet, and credits their balance. Only the payer starts this; HeyPay
 * never does it for them. The payment then moves to REFUND_PENDING and the
 * settle job closes it as REFUNDED, and checks once more that no payout was
 * paid for it.
 */
export async function selfRefundEscrow(input: {
  id: string;
  payerId: string;
  ip?: string;
}): Promise<SelfRefundResult> {
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

  await assertRefundOpen(escrow, jobId);
  await stopPayout(p);
  await claimRefund(p);

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
      await dropClaim(p.id);
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
    await markTakenBack(tx, p);
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

// ---- a deposit the payer signed with their own wallet ----

// Long enough to read and approve the refund in the wallet, as for the deposit.
const REFUND_VALID_SECONDS = DEPOSIT_VALID_SECONDS;
// How long past its last valid second a refund the network accepted is still
// looked for: the ledger that takes it in closes a few seconds after it was sent.
const REFUND_RESULT_GRACE_MS = 10_000;

const NOTHING_FOR_OWN_WALLET =
  "This payment has nothing in escrow for your own wallet to take back.";

/** Why a signed refund was not taken, for the screen that sent it. */
export type SignedRefundRefusal =
  /** Not a transaction this network can read. */
  | "not_a_transaction"
  /** Not the escrow refund for this payment: something in it differs. */
  | "not_the_refund"
  /** Its validity has run out. */
  | "expired"
  /** Not signed by the key of the account the deposit came from. */
  | "not_signed"
  /** The network did not run it. */
  | "network_rejected";

/**
 * For a payment the payer signed with their own wallet: says what the refund
 * after the deadline must be, so the payer's browser can build it and their
 * wallet can sign it. HeyPay builds and signs nothing here, and holds no key
 * that could. It follows the payment, not the wallet the payer pays with now:
 * only the account the deposit came from can take it back.
 */
export async function prepareOwnWalletRefund(input: {
  id: string;
  payerId: string;
}): Promise<EscrowTimeoutRefundInstructions> {
  const p = await db.payment.findUnique({ where: { id: input.id } });
  if (!p) throw notFound("payment not found");
  if (p.payerId !== input.payerId) throw forbidden("not your payment");
  const from = ownDeposit(p);
  const contractId = escrowContractId(p.asset);
  if (!from || !contractId) throw conflict(NOTHING_FOR_OWN_WALLET);
  await assertRefundOpen(escrowFor(p.asset), Buffer.from(p.escrowJobId!, "hex"));

  // The payer's browser asks this server to simulate the refund.
  const rpcUrl = process.env.SOROBAN_RPC_URL;
  if (!rpcUrl) throw new Error("SOROBAN_RPC_URL is not set");

  // Whole seconds, as the network counts them.
  const validUntil = Math.floor(Date.now() / 1000 + REFUND_VALID_SECONDS) * 1000;
  return {
    paymentId: p.id,
    contractId,
    jobId: p.escrowJobId!,
    from,
    networkPassphrase: getNetworkPassphrase(),
    rpcUrl,
    validUntil: new Date(validUntil).toISOString(),
  };
}

/**
 * Takes the refund a payer signed with their own wallet, checks it is
 * `refund_after_timeout(jobId)` for this payment and nothing else, and hands it
 * to the network. As with a refund from the HeyPay wallet, the payout is
 * stopped first and the refund is claimed, so the payment is never both paid
 * out and refunded. The contract pays the refund to the account the deposit
 * came from, so no HeyPay balance is credited. The payment then moves to
 * REFUND_PENDING and the settle job closes it as REFUNDED.
 */
export async function acceptSignedRefund(input: {
  id: string;
  payerId: string;
  xdr: string;
  ip?: string;
}): Promise<SelfRefundResult> {
  const p = await db.payment.findUnique({ where: { id: input.id } });
  if (!p) throw notFound("payment not found");
  if (p.payerId !== input.payerId) throw forbidden("not your payment");

  const tx = readSignedTransaction(input.xdr);
  const txHash = tx.hash().toString("hex");
  // The same signed refund handed over a second time (a retried request) is
  // answered with where the payment stands, and not sent again.
  if (p.refundTxHash === txHash) {
    return { refundTxHash: txHash, status: p.status, failureReason: p.failureReason };
  }

  const from = ownDeposit(p);
  const contractId = escrowContractId(p.asset);
  if (!from || !contractId) throw conflict(NOTHING_FOR_OWN_WALLET);
  const jobId = Buffer.from(p.escrowJobId!, "hex");
  await assertRefundOpen(escrowFor(p.asset), jobId);

  const now = Date.now();
  const fault = signedCallFault(
    tx,
    {
      from,
      contractId,
      method: "refund_after_timeout",
      args: [nativeToScVal(jobId, { type: "bytes" })],
      notAfter: now + (REFUND_VALID_SECONDS + CLOCK_SLACK_SECONDS) * 1000,
    },
    now,
  );
  if (fault === "expired") {
    throw badRequest("The transaction you signed has expired. Nothing was sent. Try again.", {
      reason: "expired" satisfies SignedRefundRefusal,
    });
  }
  if (fault === "not_signed") {
    throw badRequest(
      `The transaction is not signed by the wallet you paid from (${shortAddress(from)}). ` +
        "Switch Freighter to that account and to HeyPay's network, then try again.",
      { reason: "not_signed" satisfies SignedRefundRefusal },
    );
  }
  if (fault) {
    throw badRequest("That is not the escrow refund for this payment. Nothing was sent.", {
      reason: "not_the_refund" satisfies SignedRefundRefusal,
    });
  }

  await stopPayout(p);
  await claimRefund(p);

  let result: SentTransactionResult;
  try {
    const sent = await sendSigned(tx);
    // A refund the network turns away may be one it already ran: the payer can
    // send what they signed themselves. Asked once then; a refund it accepted
    // is waited for until it can no longer land.
    const giveUpAt =
      sent.status === "accepted"
        ? Number(tx.timeBounds!.maxTime) * 1000 + REFUND_RESULT_GRACE_MS
        : 0;
    result = sent.status === "busy" ? "NOT_FOUND" : await awaitSentTransaction(txHash, giveUpAt);
  } catch (err) {
    // Whether the refund landed is not known. The claim is kept: it lapses by
    // itself, and the settle job reads from the contract what became of the job.
    captureException(err, {
      source: "escrow.self_refund",
      paymentId: p.id,
      reference: p.reference,
      step: "own_wallet_send",
    });
    throw conflict(
      "Stellar could not be reached, so it is not known yet whether your refund went through. " +
        "Check this payment again in a few minutes.",
    );
  }
  if (result !== "SUCCESS") {
    // Turned away, failed on-chain, or never taken while it was valid: nothing moved.
    await dropClaim(p.id);
    throw conflict("Stellar did not run the refund, so nothing moved. Try again.", {
      reason: "network_rejected" satisfies SignedRefundRefusal,
    });
  }
  await db.payment.update({ where: { id: p.id }, data: { refundTxHash: txHash } });

  await db.$transaction((client) => markTakenBack(client, p));
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
      signedBy: "payer",
      refundedTo: from,
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
      payer_wallet_address: from,
      signed_by: "payer",
    },
  );
  return {
    refundTxHash: txHash,
    status: PaymentStatus.REFUND_PENDING,
    failureReason:
      p.status === PaymentStatus.REFUND_PENDING ? p.failureReason : ESCROW_EXPIRED_REASON,
  };
}
