// src/server/queue/jobs/settle.ts
import "server-only";
import { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { fastSettleEnabled, rail } from "@/server/rails";
import { walletService } from "@/server/stellar/wallet";
import {
  escrowAppliesTo,
  escrowContractId,
  escrowTimeoutLedgers,
} from "@/server/stellar/escrow-config";
import {
  escrowFor,
  escrowJobId,
  EscrowContractError,
  EscrowTxFailedError,
  type EscrowService,
} from "@/server/stellar/escrow";
import { dec, type Decimal } from "@/lib/money";
import { isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { withRetry } from "@/lib/retry";
import { decryptSecret } from "@/server/crypto/envelope";
import { audit } from "@/server/auth/audit";
import { captureException } from "@/server/observability/error-tracking";
import { captureUserEvent } from "@/server/observability/analytics";
import { assetContract, railPayload } from "@/server/observability/payment-trail";
import type { PayoutStatus } from "@/server/rails/provider";
import { enqueueSettle } from "@/server/queue/queues";
import { creditAsset, debitAsset, releaseAsset } from "@/server/wallet/balances";
import {
  applyTransition,
  isTerminal,
  nextStep,
  XLM_MOVED,
  type TxClient,
} from "@/server/payments/state-machine";

type PaymentWithRels = Awaited<ReturnType<typeof loadPayment>>;

function loadPayment(id: string) {
  return db.payment.findUniqueOrThrow({
    where: { id },
    include: { merchant: true, payer: { include: { wallet: true } } },
  });
}

/**
 * Envelope-encrypted secret of the HeyPay treasury account, used only to send a
 * payer's crypto back when their payment is refunded.
 */
/** How long to wait before re-checking a payout Xendit still reports as pending. */
const PAYOUT_RECHECK_MS = Number(process.env.PAYOUT_RECHECK_MS ?? 30_000);

/** How long a fast-settled payout is followed before it is reported as stuck. */
const FAST_SETTLE_VERIFY_WINDOW_MS = 30 * 60_000;
/** Audit action recording how a fast-settled payout really ended at Xendit. */
const FAST_SETTLE_OUTCOME = "payment.fast_settle_outcome";

/**
 * An escrow refund that started but never saved its hash may be reclaimed after
 * this long. It is longer than the escrow's transaction lifetime (180s), so the
 * earlier attempt has either landed or expired by then.
 */
export const ESCROW_REFUND_RECLAIM_MS = 5 * 60_000;

/** Why a payment its payer took back from the escrow failed, as the payer reads it. */
export const ESCROW_EXPIRED_REASON = "Escrow deadline passed before the payment settled";
/** Marks, on the REFUND_PENDING event, a refund the payer made after the deadline. */
export const ESCROW_EXPIRED_DETAIL = "escrowExpired";
/** Audit action recording how the payout of such a payment really ended. */
const EXPIRED_PAYOUT_OUTCOME = "payment.expired_payout_outcome";
/** Why a payment cancelled at the escrow deadline failed, as the payer reads it. */
export const PAYMENT_CANCELLED_REASON =
  "The merchant was not paid within the time limit, so this payment was cancelled";
/**
 * Marks, on the REFUND_PENDING event, a payment cancelled at the escrow deadline:
 * its crypto stays in the escrow until the payer takes it back themselves.
 */
export const AWAITS_PAYER_REFUND_DETAIL = "awaitsPayerRefund";

/** The payment's escrow job id as the contract's `BytesN<32>`. */
function escrowJob(p: { escrowJobId: string | null }): Buffer {
  return Buffer.from(p.escrowJobId!, "hex");
}

function treasurySecret(): string {
  const value = process.env.HEYPAY_TREASURY_SECRET_ENC?.trim();
  if (!value) throw new Error("HEYPAY_TREASURY_SECRET_ENC is not set; refunds cannot be sent");
  return value;
}

/**
 * What a payment costs the payer, split by balance. The crypto leg is denominated
 * in `payment.asset`; the Stellar fee is always XLM. When the asset *is* XLM the
 * two collapse into one balance, and `xlmFee` is folded into `assetAmount` so the
 * ledger keeps writing a single combined entry, exactly as it did pre-multi-asset.
 */
type PaymentLegs = { asset: PaymentAsset; assetAmount: Decimal; xlmFee: Decimal | null };

function legs(p: {
  asset: PaymentAsset;
  amountAsset: { toString(): string };
  networkFeeXlm: { toString(): string };
}): PaymentLegs {
  const amountAsset = dec(p.amountAsset.toString());
  const networkFeeXlm = dec(p.networkFeeXlm.toString());
  if (isIssuedAsset(p.asset)) {
    return { asset: p.asset, assetAmount: amountAsset, xlmFee: networkFeeXlm };
  }
  return { asset: p.asset, assetAmount: amountAsset.plus(networkFeeXlm), xlmFee: null };
}

export async function processSettleJob(job: { data: { paymentId: string } }): Promise<void> {
  const payment = await loadPayment(job.data.paymentId);
  if (isTerminal(payment.status)) {
    // A fast-settled payment is final already; only Xendit's own answer is still owed.
    if (payment.status === PaymentStatus.SETTLED) await verifyFastSettle(payment);
    if (payment.status === PaymentStatus.REFUNDED) await verifyExpiredPayout(payment);
    return;
  }

  try {
    await dispatch(payment);
  } catch (err) {
    await handleFailure(payment, err);
    return; // terminal/refund path handled; do not rethrow
  }

  const fresh = await db.payment.findUniqueOrThrow({
    where: { id: payment.id },
    select: { status: true },
  });
  // Only chain the next step when this one advanced. A payout still pending at
  // Xendit leaves the status unchanged; the Xendit webhook or the reconcile job
  // re-drives it, instead of this job polling Xendit in a tight loop.
  if (fresh.status !== payment.status && !isTerminal(fresh.status) && nextStep(fresh.status)) {
    await enqueueSettle(payment.id);
  }
}

async function dispatch(p: PaymentWithRels): Promise<void> {
  switch (p.status) {
    case PaymentStatus.AUTHORIZED:
      return stepSubmitStellar(p);
    case PaymentStatus.STELLAR_SUBMITTED:
      return stepConfirmStellar(p);
    case PaymentStatus.STELLAR_CONFIRMED:
      return stepRequestPayout(p);
    case PaymentStatus.PAYOUT_SUBMITTED:
      return stepCheckPayout(p);
    case PaymentStatus.REFUND_PENDING:
      return stepRefund(p);
    default:
      return; // CREATED/QUOTED are driven synchronously by quote/confirm
  }
}

// AUTHORIZED → STELLAR_SUBMITTED (payer's crypto → HeyPay treasury)
async function stepSubmitStellar(p: PaymentWithRels): Promise<void> {
  // ESCROW_ENABLED only decides for new payments. Later steps follow `escrowJobId`,
  // so turning it off never strands a payment already in the escrow.
  if (p.escrowJobId || escrowAppliesTo(p.asset)) return stepDepositEscrow(p);
  const wallet = p.payer.wallet!;
  const { asset, assetAmount } = legs(p);
  // Idempotency: if a tx was already submitted, just advance.
  let txHash = p.stellarTxHash;
  if (!txHash) {
    const deposit = await withRetry(() => rail.getDepositAddress(asset), {
      label: "getDepositAddress",
    });
    // The payment reference is the memo, so every treasury deposit traces back
    // to its payment.
    const memo = deposit.memo ?? p.reference;
    const res = await withRetry(
      () =>
        walletService.sendAsset({
          encryptedSecret: wallet.encryptedSecret,
          destination: deposit.address,
          asset,
          amount: assetAmount,
          memo,
        }),
      { label: "sendAsset" },
    );
    txHash = res.txHash;
    await db.payment.update({ where: { id: p.id }, data: { stellarTxHash: txHash } });
    captureUserEvent(
      "payment_crypto_sent",
      { id: p.payerId, role: "PAYER" },
      {
        payment_id: p.id,
        reference: p.reference,
        merchant_id: p.merchantId,
        asset,
        ...assetContract(asset),
        amount_asset: assetAmount.toFixed(7),
        payer_wallet_address: wallet.stellarPublicKey,
        destination_address: deposit.address,
        memo,
        stellar_tx_hash: txHash,
      },
    );
  }
  await applyTransition(db, p, PaymentStatus.STELLAR_SUBMITTED, { stellarTxHash: txHash });
}

// AUTHORIZED → STELLAR_SUBMITTED (payer's crypto → Soroban escrow, held under the payment's job id)
async function stepDepositEscrow(p: PaymentWithRels): Promise<void> {
  const wallet = p.payer.wallet!;
  const { asset, assetAmount } = legs(p);
  // Each escrow instance holds one token, so the asset picks the contract.
  const escrow = escrowFor(asset);
  const jobId = escrowJobId(p.id);
  let txHash = p.stellarTxHash;
  if (!txHash) {
    if (!p.escrowJobId) {
      // Marks the payment as escrowed before anything is sent, so a rerun after a
      // crash asks the contract instead of paying the treasury directly.
      await db.payment.update({
        where: { id: p.id },
        data: { escrowJobId: jobId.toString("hex") },
      });
    }
    await syncEscrowTimeout(escrow);
    // No withRetry: its timeout is shorter than the deposit's confirmation wait,
    // and a retry racing a deposit still in flight gains nothing.
    try {
      const res = await escrow.deposit({
        jobId,
        encryptedSecret: wallet.encryptedSecret,
        amount: assetAmount,
      });
      txHash = res.txHash;
    } catch (err) {
      if (err instanceof EscrowTxFailedError && err.status !== "FAILED" && err.txHash) {
        // Sent but not seen landing in time; the confirm step decides from the hash.
        txHash = err.txHash;
      } else if (err instanceof EscrowContractError && err.code === "JobExists") {
        // An earlier attempt deposited but crashed before saving its hash. The
        // contract refuses a second deposit, so nothing moved twice.
        const job = await escrow.getJob(jobId);
        if (job?.from !== wallet.stellarPublicKey) throw err;
      } else {
        throw err;
      }
    }
    if (txHash) {
      await db.payment.update({ where: { id: p.id }, data: { stellarTxHash: txHash } });
    }
    captureUserEvent(
      "payment_crypto_sent",
      { id: p.payerId, role: "PAYER" },
      {
        payment_id: p.id,
        reference: p.reference,
        merchant_id: p.merchantId,
        asset,
        ...assetContract(asset),
        amount_asset: assetAmount.toFixed(7),
        payer_wallet_address: wallet.stellarPublicKey,
        destination_address: escrowContractId(asset) ?? undefined,
        escrow_job_id: jobId.toString("hex"),
        stellar_tx_hash: txHash ?? undefined,
      },
    );
  }
  await applyTransition(db, p, PaymentStatus.STELLAR_SUBMITTED, {
    stellarTxHash: txHash,
    escrowJobId: jobId.toString("hex"),
  });
}

/**
 * Keeps the contract's payer self-refund window at ESCROW_TIMEOUT_LEDGERS. The
 * contract reads the window when a deposit happens, so it is checked before
 * each one, on the instance about to take it; jobs already held keep the
 * deadline they were given.
 */
async function syncEscrowTimeout(escrow: EscrowService): Promise<void> {
  const wanted = escrowTimeoutLedgers();
  if (wanted === null || (await escrow.getTimeout()) === wanted) return;
  try {
    await escrow.setTimeout(wanted);
  } catch (err) {
    // Another deposit may have set it at the same moment, taking the treasury's
    // sequence number; that is fine as long as the window is now the wanted one.
    if ((await escrow.getTimeout()) !== wanted) throw err;
  }
}

// STELLAR_SUBMITTED → STELLAR_CONFIRMED (debit + release reservation) | FAILED (tx never landed)
async function stepConfirmStellar(p: PaymentWithRels): Promise<void> {
  const wallet = p.payer.wallet!;
  const { asset, assetAmount, xlmFee } = legs(p);
  // A Soroban deposit is confirmed by its hash like any payment. Only an escrow
  // deposit whose hash was lost has none; the contract holding the job proves it.
  const ok = p.stellarTxHash
    ? await withRetry(() => walletService.confirmTx(p.stellarTxHash!), { label: "confirmTx" })
    : (await escrowFor(asset).getJob(escrowJob(p))) !== null;
  // A contract call pays a Soroban resource fee that `networkFeeXlm` (the classic
  // base fee) does not cover. Read what the deposit really charged, so the
  // payer's balance matches the chain. Skipped on a rerun that already debited.
  const debited =
    ok &&
    (await db.walletTransaction.findFirst({ where: { paymentId: p.id, type: "PAYMENT_DEBIT" } }));
  const sorobanFee = ok && p.escrowJobId && !debited ? await escrowFeeCharged(p) : null;
  // The deposit is one transaction, so what it charged already includes the base
  // fee. An issued asset's base fee is debited from XLM on its own below; only
  // the rest is added here, and the two entries add up to what the chain took.
  const escrowFee = sorobanFee && xlmFee ? sorobanFee.minus(xlmFee) : sorobanFee;

  if (!ok) {
    // Tx definitively failed → crypto never moved → release reservations, FAILED (no refund needed).
    await db.$transaction(async (tx) => {
      await releaseReservations(tx, wallet.id, p);
      await applyTransition(tx, p, PaymentStatus.FAILED, {
        failureReason: "stellar tx failed to confirm",
      });
      await tx.payment.update({
        where: { id: p.id },
        data: { failureReason: "stellar tx failed to confirm" },
      });
    });
    return;
  }

  await db.$transaction(async (tx) => {
    // Idempotency: skip if a debit already exists for this payment.
    const existing = await tx.walletTransaction.findFirst({
      where: { paymentId: p.id, type: "PAYMENT_DEBIT" },
    });
    if (!existing) {
      const balanceAfter = await debitAsset(tx, wallet.id, asset, assetAmount);
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "PAYMENT_DEBIT",
          asset,
          amount: assetAmount.negated().toFixed(7),
          balanceAfter: balanceAfter.toFixed(7),
          stellarTxHash: p.stellarTxHash,
          paymentId: p.id,
          memo: p.reference,
        },
      });
      if (xlmFee) {
        // The Stellar fee for an issued-asset payment leaves the XLM balance, not
        // the asset one. It shares the payment's tx hash, which is unique on
        // WalletTransaction, so this entry carries none.
        const xlmAfter = await debitAsset(tx, wallet.id, "XLM", xlmFee);
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "PAYMENT_DEBIT",
            asset: "XLM",
            amount: xlmFee.negated().toFixed(7),
            balanceAfter: xlmAfter.toFixed(7),
            paymentId: p.id,
            memo: `${p.reference} network fee`,
          },
        });
      }
      if (escrowFee?.greaterThan(0)) {
        // Shares the deposit's tx hash like the fee entry above, so it carries none.
        const xlmAfter = await debitAsset(tx, wallet.id, "XLM", escrowFee);
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "PAYMENT_DEBIT",
            asset: "XLM",
            amount: escrowFee.negated().toFixed(7),
            balanceAfter: xlmAfter.toFixed(7),
            paymentId: p.id,
            memo: `${p.reference} escrow network fee`,
          },
        });
      }
    }
    await applyTransition(tx, p, PaymentStatus.STELLAR_CONFIRMED, {
      asset,
      debitedAsset: assetAmount.toFixed(7),
      debitedXlmFee: xlmFee?.toFixed(7),
      debitedEscrowFeeXlm: escrowFee?.toFixed(7),
    });
  });
}

// STELLAR_CONFIRMED → PAYOUT_SUBMITTED (decrypt bank acct in-memory)
async function stepRequestPayout(p: PaymentWithRels): Promise<void> {
  let payoutRef = p.payoutRef;
  if (!payoutRef) {
    // A request an earlier run had already claimed is finished, not judged again:
    // since that claim no refund was possible, the rail may already hold the
    // payout, and asking again is safe (the reference is the idempotency key).
    if (!p.payoutRequestedAt) {
      if (p.escrowJobId) {
        // A payout is only requested against crypto the escrow still holds, with
        // time left on it. This is also what stops a payment from going on after
        // the worker was down past the deadline, or after the payer took it back.
        const hold = await escrowHold(p);
        // Never start a payout for crypto the payer is already entitled to take back.
        if (hold === "expired") {
          await cancelAtDeadline(p);
          return;
        }
        // The payer already has it: paying the merchant now would pay for a refund.
        if (hold === "refunded") throw new Error(ESCROW_EXPIRED_REASON);
        if (hold === "unknown") {
          // The contract cannot be read; the payout waits until it can.
          await enqueueSettle(p.id, { delayMs: PAYOUT_RECHECK_MS });
          return;
        }
      }
      if (!(await claimPayoutRequest(p))) {
        // A refund of this payment has started; see shortly how it ended.
        await enqueueSettle(p.id, { delayMs: PAYOUT_RECHECK_MS });
        return;
      }
    }
    const accountNumber = decryptSecret(p.merchant.accountNumber);
    // The rail retries internally with the payment reference as its idempotency
    // key, so a retried request never pays the merchant twice.
    const res = await rail.createPayout({
      ref: p.reference,
      phpAmount: dec(p.amountPhp.toString()),
      bank: {
        bankCode: p.merchant.settlementBankCode,
        accountName: p.merchant.accountName,
        accountNumber,
      },
      receiptEmail: p.merchant.payoutEmail,
    });
    payoutRef = res.payoutRef;
    await db.payment.update({ where: { id: p.id }, data: { payoutRef } });
    capturePayoutEvent("payment_payout_submitted", p, {
      payout_ref: payoutRef,
      xendit_payload: railPayload(res.raw),
    });
  }
  await applyTransition(db, p, PaymentStatus.PAYOUT_SUBMITTED, { payoutRef });
}

/**
 * Marks the payout request as started, in one atomic update that only succeeds
 * while no refund of the payment has started. A refund (the payer's own, or an
 * admin's) takes the opposite claim on the same row, so a payment can never be
 * both paid out and refunded because the two ran at the same moment.
 */
async function claimPayoutRequest(p: PaymentWithRels): Promise<boolean> {
  const claimed = await db.payment.updateMany({
    where: {
      id: p.id,
      status: PaymentStatus.STELLAR_CONFIRMED,
      payoutRef: null,
      refundTxHash: null,
      // A refund attempt left unfinished this long has expired without moving
      // anything (the escrow job is still held, or this point is never reached).
      OR: [
        { refundSubmittedAt: null },
        { refundSubmittedAt: { lt: new Date(Date.now() - ESCROW_REFUND_RECLAIM_MS) } },
      ],
    },
    data: { payoutRequestedAt: new Date() },
  });
  return claimed.count === 1;
}

// PAYOUT_SUBMITTED → SETTLED | (FAILED payout throws → refund) | unchanged while pending
async function stepCheckPayout(p: PaymentWithRels): Promise<void> {
  const status = await rail.getPayoutStatus(p.payoutRef!);
  if (status.state === "PENDING") {
    if (fastSettleEnabled()) return settleOnAccept(p, status);
    // Past the escrow deadline the payer may take the crypto back, so the payout
    // must not go on: stop it first. If the rail cannot stop it any more, the
    // payment stays open and is settled or refunded by how the payout ends.
    if (p.escrowJobId && (await escrowHold(p)) === "expired") {
      const stopped = await cancelPayout(p);
      if (stopped?.state === "FAILED") {
        capturePayoutEvent(
          "payment_payout_cancelled",
          p,
          payoutResultProperties(p.payoutRef!, stopped),
        );
        await cancelAtDeadline(p);
        return;
      }
      if (stopped?.state === "SETTLED") {
        capturePayoutEvent(
          "payment_payout_settled",
          p,
          payoutResultProperties(p.payoutRef!, stopped),
        );
        await markSettled(p, stopped);
        return;
      }
    }
    // Check again shortly. The Xendit webhook usually arrives first; this keeps a
    // payout moving where no webhook can reach us (local dev) or one is missed.
    await enqueueSettle(p.id, { delayMs: PAYOUT_RECHECK_MS });
    return;
  }
  capturePayoutEvent(
    status.state === "SETTLED" ? "payment_payout_settled" : "payment_payout_failed",
    p,
    payoutResultProperties(p.payoutRef!, status),
  );
  if (status.state === "FAILED") {
    throw new Error(`Payout ${p.payoutRef} failed: ${status.failureCode ?? "unknown reason"}`);
  }
  await markSettled(p, status);
}

/**
 * PAYOUT_SUBMITTED → SETTLED. Returns false when the escrow release has to be
 * retried first, leaving the payment where it was.
 */
async function markSettled(
  p: PaymentWithRels,
  status: PayoutStatus,
  detail: Record<string, string | boolean | undefined> = {},
): Promise<boolean> {
  if (p.escrowJobId && !p.escrowReleaseTxHash && !(await releaseEscrow(p))) return false;
  const feePhp = dec(status.feePhp?.toString() ?? "0");
  const netPhp = status.netPhp
    ? dec(status.netPhp.toString())
    : dec(p.amountPhp.toString()).minus(feePhp);
  await db.payment.update({
    where: { id: p.id },
    data: {
      netSettledPhp: netPhp.toFixed(2),
      payoutFeePhp: feePhp.toFixed(2),
      settledAt: new Date(),
    },
  });
  await applyTransition(db, p, PaymentStatus.SETTLED, {
    netSettledPhp: netPhp.toFixed(2),
    ...detail,
  });
  return true;
}

/**
 * Fast settle (Xendit test key only, see `fastSettleEnabled`): a payout Xendit
 * has accepted is treated as paid, so nobody waits out the test simulator. The
 * payout keeps running at Xendit; `verifyFastSettle` records how it really ended.
 */
async function settleOnAccept(p: PaymentWithRels, status: PayoutStatus): Promise<void> {
  const settled = await markSettled(p, status, { fastSettle: true, railStatus: status.railStatus });
  if (!settled) return;
  capturePayoutEvent(
    "payment_payout_fast_settled",
    p,
    payoutResultProperties(p.payoutRef!, status),
  );
  await enqueueSettle(p.id, { delayMs: PAYOUT_RECHECK_MS });
}

/**
 * Asks Xendit how a fast-settled payout really ended and records the answer
 * once. The payment stays SETTLED either way: a payout that failed after the
 * payer was told it was sent is reported for a person to look at.
 */
async function verifyFastSettle(p: PaymentWithRels): Promise<void> {
  if (!p.payoutRef) return;
  const settled = await db.paymentEvent.findFirst({
    where: {
      paymentId: p.id,
      toStatus: PaymentStatus.SETTLED,
      detail: { path: ["fastSettle"], equals: true },
    },
  });
  if (!settled) return;
  const recorded = await db.auditLog.findFirst({
    where: { action: FAST_SETTLE_OUTCOME, target: p.id },
  });
  if (recorded) return;

  const status = await rail.getPayoutStatus(p.payoutRef);
  const overdue = Date.now() - settled.createdAt.getTime() > FAST_SETTLE_VERIFY_WINDOW_MS;
  if (status.state === "PENDING" && !overdue) {
    await enqueueSettle(p.id, { delayMs: PAYOUT_RECHECK_MS });
    return;
  }
  await audit({
    action: FAST_SETTLE_OUTCOME,
    target: p.id,
    metadata: {
      reference: p.reference,
      payoutRef: p.payoutRef,
      railState: status.state,
      railStatus: status.railStatus,
      failureCode: status.failureCode,
    },
  });
  if (status.state === "SETTLED") {
    capturePayoutEvent("payment_payout_settled", p, payoutResultProperties(p.payoutRef, status));
    return;
  }
  if (status.state === "FAILED") {
    capturePayoutEvent("payment_payout_failed", p, payoutResultProperties(p.payoutRef, status));
  }
  captureException(
    new Error(
      status.state === "FAILED"
        ? `Fast-settled payout ${p.payoutRef} failed: ${status.failureCode ?? "unknown reason"}`
        : `Fast-settled payout ${p.payoutRef} is still pending at Xendit`,
    ),
    { source: "settle", paymentId: p.id, reference: p.reference, fastSettle: true },
  );
}

/**
 * Where an escrowed payment's crypto stands: `held` with time left (or already
 * released to the treasury), `expired` when still held past its deadline ledger,
 * `refunded` when the payer has it back, `unknown` when the contract cannot be
 * read. Unknown must never cancel a payment, nor let a payout start.
 */
async function escrowHold(
  p: PaymentWithRels,
): Promise<"held" | "expired" | "refunded" | "unknown"> {
  if (p.refundTxHash) return "refunded";
  try {
    const escrow = escrowFor(p.asset);
    const job = await escrow.getJob(escrowJob(p));
    if (!job) return "unknown";
    if (job.status === "Refunded") return "refunded";
    if (job.status !== "Held") return "held";
    return (await escrow.getLatestLedger()) >= job.deadlineLedger ? "expired" : "held";
  } catch (err) {
    captureException(err, {
      source: "settle",
      paymentId: p.id,
      reference: p.reference,
      step: "escrow_hold",
    });
    return "unknown";
  }
}

/**
 * Asks the rail to stop the payment's payout. Null when the rail could not be
 * asked: not knowing must never cancel a payment whose payout may still be paid.
 */
async function cancelPayout(p: PaymentWithRels): Promise<PayoutStatus | null> {
  try {
    return await rail.cancelPayout(p.payoutRef!);
  } catch (err) {
    captureException(err, {
      source: "settle",
      paymentId: p.id,
      reference: p.reference,
      step: "payout_cancel",
    });
    return null;
  }
}

/**
 * The escrow deadline passed and no payout can be paid any more (it was stopped,
 * or never requested): the payment cannot proceed. It moves to REFUND_PENDING and
 * waits there for the payer to take the crypto back from the escrow themselves;
 * the settle job does not refund it.
 */
async function cancelAtDeadline(p: PaymentWithRels): Promise<void> {
  const cancelled = await db.$transaction(async (tx) => {
    // Only while the payment's payout is as this job saw it. If another job has
    // started a payout request meanwhile, the payment is not cancelled: the rail
    // may be about to pay it.
    const still = await tx.payment.updateMany({
      where: {
        id: p.id,
        status: p.status,
        payoutRef: p.payoutRef,
        payoutRequestedAt: p.payoutRequestedAt,
      },
      data: { failureReason: PAYMENT_CANCELLED_REASON },
    });
    if (still.count === 0) return false;
    await applyTransition(tx, p, PaymentStatus.REFUND_PENDING, {
      failureReason: PAYMENT_CANCELLED_REASON,
      [AWAITS_PAYER_REFUND_DETAIL]: true,
    });
    return true;
  });
  if (!cancelled) return;
  await audit({
    action: "payment.cancelled_at_escrow_deadline",
    target: p.id,
    metadata: { reference: p.reference, payoutRef: p.payoutRef, escrowJobId: p.escrowJobId },
  });
}

/** Whether the payment's latest move to REFUND_PENDING left the refund to the payer. */
async function awaitsPayerRefund(paymentId: string): Promise<boolean> {
  const latest = await db.paymentEvent.findFirst({
    where: { paymentId, toStatus: PaymentStatus.REFUND_PENDING },
    orderBy: { createdAt: "desc" },
  });
  const detail = latest?.detail as Record<string, unknown> | null | undefined;
  return detail?.[AWAITS_PAYER_REFUND_DETAIL] === true;
}

/** The REFUND_PENDING event of a payment its payer took back after the deadline. */
function expiredEvent(paymentId: string) {
  return db.paymentEvent.findFirst({
    where: {
      paymentId,
      toStatus: PaymentStatus.REFUND_PENDING,
      detail: { path: [ESCROW_EXPIRED_DETAIL], equals: true },
    },
  });
}

/**
 * A payment its payer took back from the escrow may still be paid out by the
 * rail, because the payout was already running. Records how that payout ended, once.
 * One that succeeded means the merchant was paid and the payer refunded, which
 * a person has to follow up; the payment stays REFUNDED.
 */
async function verifyExpiredPayout(p: PaymentWithRels): Promise<void> {
  if (!p.payoutRef) return;
  const expired = await expiredEvent(p.id);
  if (!expired) return;
  const recorded = await db.auditLog.findFirst({
    where: { action: EXPIRED_PAYOUT_OUTCOME, target: p.id },
  });
  if (recorded) return;

  const status = await rail.getPayoutStatus(p.payoutRef);
  const overdue = Date.now() - expired.createdAt.getTime() > FAST_SETTLE_VERIFY_WINDOW_MS;
  if (status.state === "PENDING" && !overdue) {
    await enqueueSettle(p.id, { delayMs: PAYOUT_RECHECK_MS });
    return;
  }
  await audit({
    action: EXPIRED_PAYOUT_OUTCOME,
    target: p.id,
    metadata: {
      reference: p.reference,
      payoutRef: p.payoutRef,
      railState: status.state,
      railStatus: status.railStatus,
      failureCode: status.failureCode,
    },
  });
  if (status.state === "FAILED") return; // nobody was paid; the refund stands alone
  captureException(
    new Error(
      status.state === "SETTLED"
        ? `Payout ${p.payoutRef} was paid after the payer took ${p.reference} back from the escrow`
        : `Payout ${p.payoutRef} of ${p.reference}, refunded from the escrow, is still pending at the rail`,
    ),
    { source: "settle", paymentId: p.id, reference: p.reference, moneyAtRisk: true },
  );
}

/**
 * The fee an escrow deposit charged, or null when it cannot be read. Never
 * throws: the deposit has landed, and a failure here must not route the payment
 * to FAILED while its crypto sits in the escrow. An unread fee is reported so a
 * person can correct the payer's balance.
 */
async function escrowFeeCharged(p: PaymentWithRels): Promise<Decimal | null> {
  const txHash = p.stellarTxHash;
  try {
    // A deposit whose hash was lost has no transaction to read the fee from.
    if (!txHash) throw new Error(`Escrow deposit for ${p.reference} has no saved tx hash`);
    const fee = await withRetry(() => escrowFor(p.asset).getFeeCharged(txHash), {
      label: "escrow.getFeeCharged",
    });
    if (fee) return fee;
    throw new Error(`Soroban RPC has no result for escrow deposit ${txHash}`);
  } catch (err) {
    captureException(err, {
      source: "settle",
      paymentId: p.id,
      reference: p.reference,
      step: "escrow_fee",
    });
    return null;
  }
}

/**
 * Pays the held crypto to the treasury once the merchant has been paid. Returns
 * false when the release has to be retried. A failed release must never route to
 * a refund, because the merchant already has the PHP, so the payment stays
 * PAYOUT_SUBMITTED, is re-checked shortly, and the reconcile job re-drives it too.
 */
async function releaseEscrow(p: PaymentWithRels): Promise<boolean> {
  const escrow = escrowFor(p.asset);
  const jobId = escrowJob(p);
  try {
    const { txHash } = await escrow.release(jobId);
    await db.payment.update({ where: { id: p.id }, data: { escrowReleaseTxHash: txHash } });
    return true;
  } catch (err) {
    if (err instanceof EscrowContractError && err.code === "NotHeld") {
      const job = await escrow.getJob(jobId);
      // An earlier attempt released it but never saved the hash.
      if (job?.status === "Released") return true;
      if (job?.status === "Refunded") {
        // The payer took the crypto back after the deadline, yet the merchant was
        // paid: the treasury is short and a person must follow up. The payer has
        // their crypto, so the payment is refunded, never settled; failing here
        // sends it down the refund path, which closes it as REFUNDED.
        await audit({
          action: "payment.escrow_refunded_before_release",
          target: p.id,
          metadata: { reference: p.reference, escrowJobId: p.escrowJobId },
        });
        throw new Error(ESCROW_EXPIRED_REASON);
      }
    }
    captureException(err, {
      source: "settle",
      paymentId: p.id,
      reference: p.reference,
      step: "escrow_release",
    });
    await enqueueSettle(p.id, { delayMs: PAYOUT_RECHECK_MS });
    return false;
  }
}

// REFUND_PENDING → REFUNDED (send crypto back from the treasury; credit payer; alert admin)
async function stepRefund(p: PaymentWithRels): Promise<void> {
  if (p.escrowJobId) return stepRefundEscrow(p);
  const wallet = p.payer.wallet!;
  // Send back exactly what reached the treasury. The Stellar fee the payer paid
  // was consumed by the network and is not recoverable.
  const { asset, assetAmount } = legs(p);

  let txHash = p.refundTxHash;
  if (!txHash) {
    if (p.refundSubmittedAt) {
      // A previous attempt started a send but never recorded its hash, so it may
      // have landed. Sending again could refund twice; a person has to check.
      await audit({
        action: "payment.refund_unverified",
        target: p.id,
        metadata: { reference: p.reference, asset, amount: assetAmount.toFixed(7) },
      });
      throw new Error(
        `Refund for ${p.reference} may already have been sent; verify the treasury on-chain`,
      );
    }
    const encryptedSecret = treasurySecret();
    // Claim the send atomically. Two settle jobs can run for one payment (a webhook
    // and a re-check); only the one that sets the marker may send the refund.
    const claimed = await db.payment.updateMany({
      where: { id: p.id, refundSubmittedAt: null, refundTxHash: null },
      data: { refundSubmittedAt: new Date() },
    });
    if (claimed.count === 0) return; // another job is sending it
    try {
      const res = await walletService.sendAsset({
        encryptedSecret,
        destination: wallet.stellarPublicKey,
        asset,
        amount: assetAmount,
        memo: `refund ${p.reference}`,
      });
      txHash = res.txHash;
    } catch (err) {
      // Horizon rejected the transaction outright, so nothing moved and a retry
      // is safe. Any other failure is ambiguous and keeps the marker.
      if ((err as Error).name === "StellarSubmitError") {
        await db.payment.update({ where: { id: p.id }, data: { refundSubmittedAt: null } });
      }
      throw err;
    }
    await db.payment.update({ where: { id: p.id }, data: { refundTxHash: txHash } });
  }

  const landed = await withRetry(() => walletService.confirmTx(txHash), { label: "confirmTx" });
  if (!landed) throw new Error(`Refund transaction ${txHash} did not confirm`);

  await creditRefund(p, txHash);
}

// REFUND_PENDING → REFUNDED for an escrowed payment: the contract returns the held
// crypto to the payer (`refund`, signed by the treasury as the escrow admin). A
// payment its payer already took back with `refund_after_timeout` arrives here
// with that refund's hash saved, and is only confirmed and closed.
//
// The refund is asked of the instance that holds the payment's asset, and an
// instance pays out only its own token: a USDC payment comes back as USDC.
async function stepRefundEscrow(p: PaymentWithRels): Promise<void> {
  const escrow = escrowFor(p.asset);
  const jobId = escrowJob(p);
  let txHash = p.refundTxHash;
  // Cancelled at the escrow deadline: the crypto is the payer's to take back.
  if (!txHash && (await awaitsPayerRefund(p.id))) return;
  if (!txHash) {
    treasurySecret(); // fail before claiming if the admin key is missing
    // Claim the refund atomically, as in stepRefund. A marker left by a crashed
    // attempt is not ambiguous here: the contract refunds a job at most once, and
    // get_job says whether it did. It is reclaimed once that attempt has expired.
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
    if (claimed.count === 0) return; // another job is refunding it
    try {
      txHash = (await escrow.refund(jobId)).txHash;
    } catch (err) {
      if (err instanceof EscrowContractError && err.code === "NotHeld") {
        const job = await escrow.getJob(jobId);
        // Released means the treasury has the crypto; a person has to refund it.
        if (job?.status !== "Refunded") throw err;
        // An earlier attempt refunded it but never saved the hash.
      } else {
        // Rejected at simulation or failed on-chain: nothing moved, retry is safe.
        const nothingMoved =
          err instanceof EscrowContractError ||
          (err instanceof EscrowTxFailedError && err.status === "FAILED");
        if (nothingMoved) {
          await db.payment.update({ where: { id: p.id }, data: { refundSubmittedAt: null } });
        }
        throw err;
      }
    }
    if (txHash) {
      await db.payment.update({ where: { id: p.id }, data: { refundTxHash: txHash } });
    }
  } else {
    // Saved by an earlier run that stopped before crediting; a fresh refund above
    // only returns once its transaction has succeeded.
    const landed = await withRetry(() => walletService.confirmTx(txHash!), {
      label: "confirmTx",
    });
    if (!landed) throw new Error(`Refund transaction ${txHash} did not confirm`);
  }

  await creditRefund(p, txHash);
  // After the payer's own refund the payout may still be paid; see how it ends.
  if (p.payoutRef && (await expiredEvent(p.id))) {
    await enqueueSettle(p.id, { delayMs: PAYOUT_RECHECK_MS });
  }
}

/**
 * Credits the refunded crypto back to the payer's balance once, marks the payment
 * REFUNDED and audits it. `txHash` is null only for an escrow refund whose hash
 * was lost; the contract's job status proved it landed.
 */
async function creditRefund(p: PaymentWithRels, txHash: string | null): Promise<void> {
  const { asset, assetAmount } = legs(p);
  await db.$transaction(async (tx) => {
    await creditRefundEntry(tx, p, txHash);
    await applyTransition(tx, p, PaymentStatus.REFUNDED, {
      asset,
      refundedAsset: assetAmount.toFixed(7),
      refundTxHash: txHash,
    });
  });
  await audit({
    action: "payment.refunded",
    target: p.id,
    metadata: {
      reference: p.reference,
      asset,
      refundedAsset: assetAmount.toFixed(7),
      refundTxHash: txHash,
      reason: p.failureReason ?? "settlement failed after crypto moved",
    },
  });
}

/**
 * Writes the wallet entry that returns a payment's crypto to the payer's balance,
 * at most once per payment. Shared with the payer's own escrow refund, which
 * credits the balance while the payment is still in flight.
 */
export async function creditRefundEntry(
  tx: TxClient,
  p: Parameters<typeof legs>[0] & {
    id: string;
    reference: string;
    payer: { wallet: { id: string } | null };
  },
  txHash: string | null,
): Promise<boolean> {
  const wallet = p.payer.wallet!;
  const { asset, assetAmount } = legs(p);
  const existing = await tx.walletTransaction.findFirst({
    where: { paymentId: p.id, type: "REFUND_CREDIT" },
  });
  if (existing) return false;
  // The deposit poller watches the payer's wallet too and may have already
  // recorded this incoming transfer as a deposit. If so the balance is
  // credited; relabel the entry rather than credit it a second time.
  const seen = txHash
    ? await tx.walletTransaction.findUnique({ where: { stellarTxHash: txHash } })
    : null;
  if (seen) {
    await tx.walletTransaction.update({
      where: { id: seen.id },
      data: { type: "REFUND_CREDIT", paymentId: p.id, memo: `refund ${p.reference}` },
    });
    return true;
  }
  const balanceAfter = await creditAsset(tx, wallet.id, asset, assetAmount);
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: "REFUND_CREDIT",
      asset,
      amount: assetAmount.toFixed(7),
      balanceAfter: balanceAfter.toFixed(7),
      stellarTxHash: txHash,
      paymentId: p.id,
      memo: `refund ${p.reference}`,
    },
  });
  return true;
}

/**
 * Debits the Soroban fee the payer's wallet paid for its own escrow refund, so
 * the balance matches the chain. The entry shares the refund's tx hash, which is
 * unique on WalletTransaction, so it carries none.
 */
export async function debitRefundFee(
  tx: TxClient,
  p: { id: string; reference: string; payer: { wallet: { id: string } | null } },
  fee: Decimal,
): Promise<void> {
  const wallet = p.payer.wallet!;
  const xlmAfter = await debitAsset(tx, wallet.id, "XLM", fee);
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: "PAYMENT_DEBIT",
      asset: "XLM",
      amount: fee.negated().toFixed(7),
      balanceAfter: xlmAfter.toFixed(7),
      paymentId: p.id,
      memo: `${p.reference} escrow refund network fee`,
    },
  });
}

// --- analytics ---

/**
 * A fiat payout event, sent to the merchant being paid and to the payer who paid,
 * so either side's timeline in PostHog shows where the PHP went.
 */
function capturePayoutEvent(
  event: string,
  p: PaymentWithRels,
  extra: Record<string, string | number | undefined>,
): void {
  const props = {
    payment_id: p.id,
    reference: p.reference,
    merchant_id: p.merchantId,
    asset: p.asset,
    ...assetContract(p.asset),
    amount_php: Number(p.amountPhp),
    payer_wallet_address: p.payer.wallet?.stellarPublicKey,
    stellar_tx_hash: p.stellarTxHash,
    bank_code: p.merchant.settlementBankCode,
    bank_name: p.merchant.settlementBankName,
    bank_account_number: accountNumberForTrail(p.merchant.accountNumber),
    bank_account_last4: p.merchant.accountNumberLast4,
    bank_account_name: p.merchant.accountName,
    payout_email: p.merchant.payoutEmail,
    ...extra,
  };
  captureUserEvent(event, { id: p.merchant.userId, role: "MERCHANT" }, props);
  captureUserEvent(event, { id: p.payerId, role: "PAYER" }, props);
}

/** The merchant's decrypted account number; undefined if it cannot be decrypted. */
function accountNumberForTrail(encrypted: string): string | undefined {
  try {
    return decryptSecret(encrypted);
  } catch {
    return undefined;
  }
}

function payoutResultProperties(
  payoutRef: string,
  status: PayoutStatus,
): Record<string, string | number | undefined> {
  return {
    payout_ref: payoutRef,
    xendit_status: status.railStatus,
    failure_code: status.failureCode,
    net_php: status.netPhp ? Number(status.netPhp) : undefined,
    xendit_payload: railPayload(status.raw),
  };
}

// --- failure routing ---
async function handleFailure(p: PaymentWithRels, err: unknown): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  const current = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
  if (isTerminal(current.status)) return;

  // Settlement failures are handled here (not rethrown), so report them explicitly.
  // A failure after the crypto moved routes to refund — flag it as money-at-risk.
  captureException(err, {
    source: "settle",
    paymentId: p.id,
    reference: p.reference,
    status: current.status,
    moneyAtRisk: XLM_MOVED.has(current.status),
  });

  if (current.status === PaymentStatus.REFUND_PENDING) {
    // The payer is still owed their crypto, so a failed refund stays pending
    // rather than closing as FAILED; the reconcile job re-drives it.
    await db.payment.update({ where: { id: p.id }, data: { failureReason: reason } });
    return;
  }

  if (XLM_MOVED.has(current.status)) {
    // Crypto already left the wallet → refund branch.
    await db.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: p.id }, data: { failureReason: reason } });
      await applyTransition(tx, current, PaymentStatus.REFUND_PENDING, { failureReason: reason });
    });
    await enqueueSettle(p.id); // drive REFUND_PENDING → REFUNDED
    return;
  }

  // Pre-move failure → FAILED; release any reservation still held.
  await db.$transaction(async (tx) => {
    if (
      current.status === PaymentStatus.AUTHORIZED ||
      current.status === PaymentStatus.STELLAR_SUBMITTED
    ) {
      await releaseReservations(tx, p.payer.wallet!.id, p);
    }
    await tx.payment.update({ where: { id: p.id }, data: { failureReason: reason } });
    await applyTransition(tx, current, PaymentStatus.FAILED, { failureReason: reason });
  });
}

/** Undo the holds taken at confirm — the asset leg and, for issued assets, the XLM fee. */
async function releaseReservations(
  tx: TxClient,
  walletId: string,
  p: Parameters<typeof legs>[0],
): Promise<void> {
  const { asset, assetAmount, xlmFee } = legs(p);
  await releaseAsset(tx, walletId, asset, assetAmount);
  if (xlmFee) await releaseAsset(tx, walletId, "XLM", xlmFee);
}
