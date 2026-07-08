// src/server/queue/jobs/settle.ts
import "server-only";
import { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { rail } from "@/server/rails";
import { walletService } from "@/server/stellar/wallet";
import { dec } from "@/lib/money";
import { withRetry, pollUntil } from "@/lib/retry";
import { decryptSecret } from "@/server/crypto/envelope";
import { audit } from "@/server/auth/audit";
import { captureException } from "@/server/observability/error-tracking";
import { enqueueSettle } from "@/server/queue/queues";
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

const TRADE_POLL = { attempts: 30, intervalMs: 1_000, label: "trade" };
const PAYOUT_POLL = { attempts: 30, intervalMs: 1_000, label: "payout" };

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
  if (!isTerminal(fresh.status) && nextStep(fresh.status) !== null) {
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
      return stepRequestTrade(p);
    case PaymentStatus.PDAX_TRADING:
      return stepPollTrade(p);
    case PaymentStatus.PDAX_TRADED:
      return stepRequestPayout(p);
    case PaymentStatus.PAYOUT_SUBMITTED:
      return stepPollPayout(p);
    case PaymentStatus.REFUND_PENDING:
      return stepRefund(p);
    default:
      return; // CREATED/QUOTED are driven synchronously by quote/confirm
  }
}

// AUTHORIZED → STELLAR_SUBMITTED
async function stepSubmitStellar(p: PaymentWithRels): Promise<void> {
  const wallet = p.payer.wallet!;
  const total = dec(p.amountXlm.toString()).plus(p.networkFeeXlm.toString());
  // Idempotency: if a tx was already submitted, just advance.
  let txHash = p.stellarTxHash;
  if (!txHash) {
    const res = await withRetry(
      () =>
        walletService.sendXlm({
          encryptedSecret: wallet.encryptedSecret,
          destination: process.env.PDAX_XLM_DEPOSIT_ADDRESS!,
          amountXlm: total,
          memo: p.reference,
        }),
      { label: "sendXlm" },
    );
    txHash = res.txHash;
    await db.payment.update({ where: { id: p.id }, data: { stellarTxHash: txHash } });
  }
  await applyTransition(db, p, PaymentStatus.STELLAR_SUBMITTED, { stellarTxHash: txHash });
}

// STELLAR_SUBMITTED → STELLAR_CONFIRMED (debit + release reservation) | FAILED (tx never landed)
async function stepConfirmStellar(p: PaymentWithRels): Promise<void> {
  const wallet = p.payer.wallet!;
  const total = dec(p.amountXlm.toString()).plus(p.networkFeeXlm.toString());
  const ok = await withRetry(() => walletService.confirmTx(p.stellarTxHash!), {
    label: "confirmTx",
  });

  if (!ok) {
    // Tx definitively failed → XLM never moved → release reservation, FAILED (no refund needed).
    await db.$transaction(async (tx) => {
      await releaseReservation(tx, wallet.id, total);
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
    const w = await tx.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    // Idempotency: skip if a debit already exists for this payment.
    const existing = await tx.walletTransaction.findFirst({
      where: { paymentId: p.id, type: "PAYMENT_DEBIT" },
    });
    if (!existing) {
      const newBalance = dec(w.cachedXlmBalance.toString()).minus(total);
      await tx.walletTransaction.create({
        data: {
          walletId: w.id,
          type: "PAYMENT_DEBIT",
          amountXlm: total.negated().toFixed(7),
          balanceAfter: newBalance.toFixed(7),
          stellarTxHash: p.stellarTxHash,
          paymentId: p.id,
          memo: p.reference,
        },
      });
      await tx.custodialWallet.update({
        where: { id: w.id },
        data: {
          cachedXlmBalance: newBalance.toFixed(7),
          reservedXlm: dec(w.reservedXlm.toString()).minus(total).toFixed(7),
        },
      });
    }
    await applyTransition(tx, p, PaymentStatus.STELLAR_CONFIRMED, { debitedXlm: total.toFixed(7) });
  });
}

// STELLAR_CONFIRMED → PDAX_TRADING
async function stepRequestTrade(p: PaymentWithRels): Promise<void> {
  let tradeRef = p.pdaxTradeRef;
  if (!tradeRef) {
    const res = await withRetry(
      () => rail.sellCryptoForPhp({ ref: p.reference, xlmAmount: dec(p.amountXlm.toString()) }),
      { label: "sellCryptoForPhp" },
    );
    tradeRef = res.tradeRef;
    await db.payment.update({ where: { id: p.id }, data: { pdaxTradeRef: tradeRef } });
  }
  await applyTransition(db, p, PaymentStatus.PDAX_TRADING, { pdaxTradeRef: tradeRef });
}

// PDAX_TRADING → PDAX_TRADED (poll; FAILED state throws → refund)
async function stepPollTrade(p: PaymentWithRels): Promise<void> {
  const status = await pollUntil(
    () => rail.getTradeStatus(p.pdaxTradeRef!),
    (s) => s.state !== "PENDING",
    TRADE_POLL,
  );
  if (status.state !== "FILLED") throw new Error(`PDAX trade ${p.pdaxTradeRef} failed`);
  const feePhp = status.feePhp ? dec(status.feePhp.toString()) : dec("0");
  await db.payment.update({ where: { id: p.id }, data: { pdaxFeePhp: feePhp.toFixed(2) } });
  await applyTransition(db, p, PaymentStatus.PDAX_TRADED, { pdaxFeePhp: feePhp.toFixed(2) });
}

// PDAX_TRADED → PAYOUT_SUBMITTED (decrypt bank acct in-memory)
async function stepRequestPayout(p: PaymentWithRels): Promise<void> {
  let payoutRef = p.pdaxCashoutRef;
  if (!payoutRef) {
    const accountNumber = decryptSecret(p.merchant.accountNumber);
    const res = await withRetry(
      () =>
        rail.cashOutPhpToBank({
          ref: p.reference,
          phpAmount: dec(p.amountPhp.toString()),
          bank: {
            bankCode: p.merchant.settlementBankCode,
            accountName: p.merchant.accountName,
            accountNumber,
          },
        }),
      { label: "cashOutPhpToBank" },
    );
    payoutRef = res.payoutRef;
    await db.payment.update({ where: { id: p.id }, data: { pdaxCashoutRef: payoutRef } });
  }
  await applyTransition(db, p, PaymentStatus.PAYOUT_SUBMITTED, { pdaxCashoutRef: payoutRef });
}

// PAYOUT_SUBMITTED → SETTLED (poll; FAILED state throws → refund)
async function stepPollPayout(p: PaymentWithRels): Promise<void> {
  const status = await pollUntil(
    () => rail.getPayoutStatus(p.pdaxCashoutRef!),
    (s) => s.state !== "PENDING",
    PAYOUT_POLL,
  );
  if (status.state !== "SETTLED") throw new Error(`PDAX payout ${p.pdaxCashoutRef} failed`);
  // Fold the cash-out fee into pdaxFeePhp (which already holds the trade fee) so
  // the payment records total PDAX fees, not just the trade leg.
  const totalFeePhp = dec(p.pdaxFeePhp.toString()).plus(status.feePhp?.toString() ?? "0");
  const netPhp = status.netPhp
    ? dec(status.netPhp.toString())
    : dec(p.amountPhp.toString()).minus(totalFeePhp);
  await db.payment.update({
    where: { id: p.id },
    data: {
      netSettledPhp: netPhp.toFixed(2),
      pdaxFeePhp: totalFeePhp.toFixed(2),
      settledAt: new Date(),
    },
  });
  await applyTransition(db, p, PaymentStatus.SETTLED, { netSettledPhp: netPhp.toFixed(2) });
}

// REFUND_PENDING → REFUNDED (credit payer wallet; alert admin)
async function stepRefund(p: PaymentWithRels): Promise<void> {
  const wallet = p.payer.wallet!;
  const total = dec(p.amountXlm.toString()).plus(p.networkFeeXlm.toString());
  await db.$transaction(async (tx) => {
    const existing = await tx.walletTransaction.findFirst({
      where: { paymentId: p.id, type: "REFUND_CREDIT" },
    });
    if (!existing) {
      const w = await tx.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const newBalance = dec(w.cachedXlmBalance.toString()).plus(total);
      await tx.walletTransaction.create({
        data: {
          walletId: w.id,
          type: "REFUND_CREDIT",
          amountXlm: total.toFixed(7),
          balanceAfter: newBalance.toFixed(7),
          paymentId: p.id,
          memo: `refund ${p.reference}`,
        },
      });
      await tx.custodialWallet.update({
        where: { id: w.id },
        data: { cachedXlmBalance: newBalance.toFixed(7) },
      });
    }
    await applyTransition(tx, p, PaymentStatus.REFUNDED, { refundedXlm: total.toFixed(7) });
  });
  await audit({
    action: "payment.refunded",
    target: p.id,
    metadata: {
      reference: p.reference,
      refundedXlm: total.toFixed(7),
      reason: p.failureReason ?? "settlement failed after XLM moved",
    },
  });
}

// --- failure routing ---
async function handleFailure(p: PaymentWithRels, err: unknown): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  const current = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
  if (isTerminal(current.status)) return;

  // Settlement failures are handled here (not rethrown), so report them explicitly.
  // A failure after XLM moved routes to refund — flag it as money-at-risk.
  captureException(err, {
    source: "settle",
    paymentId: p.id,
    reference: p.reference,
    status: current.status,
    moneyAtRisk: XLM_MOVED.has(current.status),
  });

  if (XLM_MOVED.has(current.status)) {
    // XLM already left the wallet → refund branch.
    await db.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: p.id }, data: { failureReason: reason } });
      await applyTransition(tx, current, PaymentStatus.REFUND_PENDING, { failureReason: reason });
    });
    await enqueueSettle(p.id); // drive REFUND_PENDING → REFUNDED
    return;
  }

  // Pre-XLM-move failure → FAILED; release any reservation still held.
  const total = dec(p.amountXlm.toString()).plus(p.networkFeeXlm.toString());
  await db.$transaction(async (tx) => {
    if (
      current.status === PaymentStatus.AUTHORIZED ||
      current.status === PaymentStatus.STELLAR_SUBMITTED
    ) {
      await releaseReservation(tx, p.payer.wallet!.id, total);
    }
    await tx.payment.update({ where: { id: p.id }, data: { failureReason: reason } });
    await applyTransition(tx, current, PaymentStatus.FAILED, { failureReason: reason });
  });
}

async function releaseReservation(
  tx: TxClient,
  walletId: string,
  total: import("@/lib/money").Decimal,
): Promise<void> {
  const w = await tx.custodialWallet.findUniqueOrThrow({ where: { id: walletId } });
  const next = dec(w.reservedXlm.toString()).minus(total);
  await tx.custodialWallet.update({
    where: { id: walletId },
    data: { reservedXlm: (next.isNegative() ? dec("0") : next).toFixed(7) },
  });
}
