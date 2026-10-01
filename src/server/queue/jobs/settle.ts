// src/server/queue/jobs/settle.ts
import "server-only";
import { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { rail } from "@/server/rails";
import { walletService } from "@/server/stellar/wallet";
import { findConversionRoute } from "@/server/stellar/paths";
import { dec, type Decimal } from "@/lib/money";
import { isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { withRetry, pollUntil } from "@/lib/retry";
import { decryptSecret } from "@/server/crypto/envelope";
import { audit } from "@/server/auth/audit";
import { captureException } from "@/server/observability/error-tracking";
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

const TRADE_POLL = { attempts: 30, intervalMs: 1_000, label: "trade" };
const PAYOUT_POLL = { attempts: 30, intervalMs: 1_000, label: "payout" };

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
  const { asset, assetAmount } = legs(p);
  // Idempotency: if a tx was already submitted, just advance.
  let txHash = p.stellarTxHash;
  if (!txHash) {
    // The rail receives `settlementAsset`; when that isn't the payer's asset the
    // payment converts on the DEX on its way there, in this same transaction.
    const settlementAsset = p.settlementAsset ?? asset;
    const deposit = await withRetry(() => rail.getDepositAddress(settlementAsset), {
      label: "getDepositAddress",
    });
    // The rail's address tag, when it gives one, is what credits the deposit to
    // our account — it must win over our own reference.
    const memo = deposit.memo ?? p.reference;

    const res = await withRetry(
      async () => {
        if (settlementAsset === asset || !p.settlementAmount) {
          return walletService.sendAsset({
            encryptedSecret: wallet.encryptedSecret,
            destination: deposit.address,
            asset,
            amount: assetAmount,
            memo,
          });
        }
        // Re-find the route at submission: the book has moved since quoting, and
        // the path recorded then may no longer be the cheapest (or exist).
        const destMin = dec(p.settlementAmount.toString());
        const route = await findConversionRoute(asset, settlementAsset, destMin);
        if (!route) {
          throw new Error(
            `No Stellar DEX route to convert ${asset} into ${settlementAsset} for this payment`,
          );
        }
        return walletService.sendAssetViaPath({
          encryptedSecret: wallet.encryptedSecret,
          destination: deposit.address,
          asset,
          amount: assetAmount,
          destAsset: settlementAsset,
          // Deliver at least what the rail needs; the tx fails rather than
          // short-changing the merchant.
          destMin,
          path: route.path,
          memo,
        });
      },
      { label: "sendAsset" },
    );
    txHash = res.txHash;
    await db.payment.update({ where: { id: p.id }, data: { stellarTxHash: txHash } });
  }
  await applyTransition(db, p, PaymentStatus.STELLAR_SUBMITTED, { stellarTxHash: txHash });
}

// STELLAR_SUBMITTED → STELLAR_CONFIRMED (debit + release reservation) | FAILED (tx never landed)
async function stepConfirmStellar(p: PaymentWithRels): Promise<void> {
  const wallet = p.payer.wallet!;
  const { asset, assetAmount, xlmFee } = legs(p);
  const ok = await withRetry(() => walletService.confirmTx(p.stellarTxHash!), {
    label: "confirmTx",
  });

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
    }
    await applyTransition(tx, p, PaymentStatus.STELLAR_CONFIRMED, {
      asset,
      debitedAsset: assetAmount.toFixed(7),
      debitedXlmFee: xlmFee?.toFixed(7),
    });
  });
}

// STELLAR_CONFIRMED → PDAX_TRADING
async function stepRequestTrade(p: PaymentWithRels): Promise<void> {
  let tradeRef = p.pdaxTradeRef;
  if (!tradeRef) {
    // Sell what actually reached the rail: the payer's asset when it was sent
    // directly, or the asset it was converted into on the way. The XLM network
    // fee was spent on-chain and never reached the rail either way.
    const asset = p.settlementAsset ?? p.asset;
    const amount = dec((p.settlementAmount ?? p.amountAsset).toString());
    const res = await withRetry(() => rail.sellCryptoForPhp({ ref: p.reference, asset, amount }), {
      label: "sellCryptoForPhp",
    });
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
  // Refund the asset that left the wallet. The XLM network fee was consumed by
  // the Stellar network and is not recoverable, so it is not credited back.
  const { asset, assetAmount } = legs(p);
  await db.$transaction(async (tx) => {
    const existing = await tx.walletTransaction.findFirst({
      where: { paymentId: p.id, type: "REFUND_CREDIT" },
    });
    if (!existing) {
      const balanceAfter = await creditAsset(tx, wallet.id, asset, assetAmount);
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "REFUND_CREDIT",
          asset,
          amount: assetAmount.toFixed(7),
          balanceAfter: balanceAfter.toFixed(7),
          paymentId: p.id,
          memo: `refund ${p.reference}`,
        },
      });
    }
    await applyTransition(tx, p, PaymentStatus.REFUNDED, {
      asset,
      refundedAsset: assetAmount.toFixed(7),
    });
  });
  await audit({
    action: "payment.refunded",
    target: p.id,
    metadata: {
      reference: p.reference,
      asset,
      refundedAsset: assetAmount.toFixed(7),
      reason: p.failureReason ?? "settlement failed after crypto moved",
    },
  });
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
