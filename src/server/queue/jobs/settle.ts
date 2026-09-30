// src/server/queue/jobs/settle.ts
import "server-only";
import { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { rail } from "@/server/rails";
import { walletService } from "@/server/stellar/wallet";
import { escrowAppliesTo } from "@/server/stellar/escrow-config";
import {
  escrowJobId,
  escrowService,
  EscrowContractError,
  EscrowTxFailedError,
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

/**
 * An escrow refund that started but never saved its hash may be reclaimed after
 * this long. It is longer than the escrow's transaction lifetime (180s), so the
 * earlier attempt has either landed or expired by then.
 */
const ESCROW_REFUND_RECLAIM_MS = 5 * 60_000;

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
  if (isTerminal(payment.status)) return;

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
    // No withRetry: its timeout is shorter than the deposit's confirmation wait,
    // and a retry racing a deposit still in flight gains nothing.
    try {
      const res = await escrowService.deposit({
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
        const job = await escrowService.getJob(jobId);
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
        destination_address: process.env.ESCROW_CONTRACT_ID,
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

// STELLAR_SUBMITTED → STELLAR_CONFIRMED (debit + release reservation) | FAILED (tx never landed)
async function stepConfirmStellar(p: PaymentWithRels): Promise<void> {
  const wallet = p.payer.wallet!;
  const { asset, assetAmount, xlmFee } = legs(p);
  // A Soroban deposit is confirmed by its hash like any payment. Only an escrow
  // deposit whose hash was lost has none; the contract holding the job proves it.
  const ok = p.stellarTxHash
    ? await withRetry(() => walletService.confirmTx(p.stellarTxHash!), { label: "confirmTx" })
    : (await escrowService.getJob(escrowJob(p))) !== null;
  // A contract call pays a Soroban resource fee that `networkFeeXlm` (the classic
  // base fee) does not cover. Read what the deposit really charged, so the
  // payer's balance matches the chain. Skipped on a rerun that already debited.
  const debited =
    ok &&
    (await db.walletTransaction.findFirst({ where: { paymentId: p.id, type: "PAYMENT_DEBIT" } }));
  const sorobanFee = ok && p.escrowJobId && !debited ? await escrowFeeCharged(p) : null;

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
      if (sorobanFee?.greaterThan(0)) {
        // Shares the deposit's tx hash like the fee entry above, so it carries none.
        const xlmAfter = await debitAsset(tx, wallet.id, "XLM", sorobanFee);
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "PAYMENT_DEBIT",
            asset: "XLM",
            amount: sorobanFee.negated().toFixed(7),
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
      debitedEscrowFeeXlm: sorobanFee?.toFixed(7),
    });
  });
}

// STELLAR_CONFIRMED → PAYOUT_SUBMITTED (decrypt bank acct in-memory)
async function stepRequestPayout(p: PaymentWithRels): Promise<void> {
  let payoutRef = p.payoutRef;
  if (!payoutRef) {
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

// PAYOUT_SUBMITTED → SETTLED | (FAILED payout throws → refund) | unchanged while pending
async function stepCheckPayout(p: PaymentWithRels): Promise<void> {
  const status = await rail.getPayoutStatus(p.payoutRef!);
  if (status.state === "PENDING") {
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
  if (p.escrowJobId && !p.escrowReleaseTxHash && !(await releaseEscrow(p))) return;
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
  await applyTransition(db, p, PaymentStatus.SETTLED, { netSettledPhp: netPhp.toFixed(2) });
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
    const fee = await withRetry(() => escrowService.getFeeCharged(txHash), {
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
  const jobId = escrowJob(p);
  try {
    const { txHash } = await escrowService.release(jobId);
    await db.payment.update({ where: { id: p.id }, data: { escrowReleaseTxHash: txHash } });
    return true;
  } catch (err) {
    if (err instanceof EscrowContractError && err.code === "NotHeld") {
      const job = await escrowService.getJob(jobId);
      // An earlier attempt released it but never saved the hash.
      if (job?.status === "Released") return true;
      if (job?.status === "Refunded") {
        // The payer self-refunded after the deadline, yet the merchant was paid.
        // The payment is settled; the treasury is short and a person must follow up.
        await audit({
          action: "payment.escrow_refunded_before_release",
          target: p.id,
          metadata: { reference: p.reference, escrowJobId: p.escrowJobId },
        });
        captureException(err, { source: "settle", paymentId: p.id, moneyAtRisk: true });
        return true;
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
// crypto to the payer (`refund`, signed by the treasury as the escrow admin).
async function stepRefundEscrow(p: PaymentWithRels): Promise<void> {
  const jobId = escrowJob(p);
  let txHash = p.refundTxHash;
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
      txHash = (await escrowService.refund(jobId)).txHash;
    } catch (err) {
      if (err instanceof EscrowContractError && err.code === "NotHeld") {
        const job = await escrowService.getJob(jobId);
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
}

/**
 * Credits the refunded crypto back to the payer's balance once, marks the payment
 * REFUNDED and audits it. `txHash` is null only for an escrow refund whose hash
 * was lost; the contract's job status proved it landed.
 */
async function creditRefund(p: PaymentWithRels, txHash: string | null): Promise<void> {
  const wallet = p.payer.wallet!;
  const { asset, assetAmount } = legs(p);
  await db.$transaction(async (tx) => {
    const existing = await tx.walletTransaction.findFirst({
      where: { paymentId: p.id, type: "REFUND_CREDIT" },
    });
    if (!existing) {
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
      } else {
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
      }
    }
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
