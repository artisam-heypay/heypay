// src/server/queue/jobs/reconcile.ts
import "server-only";
import { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { rail } from "@/server/rails";
import { walletService } from "@/server/stellar/wallet";
import { enqueueSettle } from "@/server/queue/queues";
import { audit } from "@/server/auth/audit";
import { captureException } from "@/server/observability/error-tracking";
import { dec } from "@/lib/money";

// A settle job advances an in-flight payment within seconds; a payment sitting in
// a mid-settlement state longer than this means its worker job was lost, or the
// rail moved on without us. Reconcile re-checks the rail and re-drives it.
const STALE_MS = 2 * 60_000;
// Cap rail calls per run so one reconcile tick can't stampede PDAX.
const MAX_PAYMENTS_PER_RUN = 50;

// States that carry a PDAX reference we can authoritatively diff against.
const TRADE_STATES: PaymentStatus[] = [PaymentStatus.PDAX_TRADING];
const PAYOUT_STATES: PaymentStatus[] = [PaymentStatus.PAYOUT_SUBMITTED];
// In-flight states with no fresh rail ref to poll — a stuck one just needs the
// worker to resume (re-enqueue drives STELLAR_CONFIRMED→trade, PDAX_TRADED→payout,
// REFUND_PENDING→refund).
const STUCK_STATES: PaymentStatus[] = [
  PaymentStatus.STELLAR_CONFIRMED,
  PaymentStatus.PDAX_TRADED,
  PaymentStatus.REFUND_PENDING,
];
const IN_FLIGHT: PaymentStatus[] = [...TRADE_STATES, ...PAYOUT_STATES, ...STUCK_STATES];

export type ReconcileResult = {
  checked: number; // wallets checked (XLM leg)
  drift: number; // wallets whose cached balance differed from Horizon
  paymentsChecked: number; // stale in-flight payments inspected (PHP/PDAX leg)
  paymentDrift: number; // payments the rail had moved past, or that were stuck
};

export async function processReconcileJob(): Promise<ReconcileResult> {
  const wallet = await reconcileWallets();
  const payment = await reconcilePayments();
  return {
    checked: wallet.checked,
    drift: wallet.drift,
    paymentsChecked: payment.checked,
    paymentDrift: payment.drift,
  };
}

// XLM leg: diff each custodial wallet's cached balance against Horizon.
async function reconcileWallets(): Promise<{ checked: number; drift: number }> {
  const wallets = await db.custodialWallet.findMany();
  let drift = 0;

  for (const wallet of wallets) {
    let horizon;
    try {
      horizon = await walletService.getBalance(wallet.stellarPublicKey);
    } catch (err) {
      console.error("[reconcile] getBalance failed", {
        walletId: wallet.id,
        error: (err as Error).message,
      });
      continue;
    }
    const cached = dec(wallet.cachedXlmBalance.toString());
    if (!cached.equals(horizon)) {
      drift++;
      await audit({
        action: "reconcile.drift",
        target: wallet.id,
        metadata: {
          publicKey: wallet.stellarPublicKey,
          cachedXlm: cached.toFixed(7),
          horizonXlm: horizon.toFixed(7),
          deltaXlm: horizon.minus(cached).toFixed(7),
        },
      });
    }
  }

  return { checked: wallets.length, drift };
}

// PHP/PDAX leg: for each stale in-flight payment, ask the rail where it actually
// is. If the rail has moved past our local status (or the payment is simply
// stuck), flag drift to admin and re-enqueue settle to self-heal.
async function reconcilePayments(): Promise<{ checked: number; drift: number }> {
  const stale = await db.payment.findMany({
    where: {
      status: { in: IN_FLIGHT },
      updatedAt: { lt: new Date(Date.now() - STALE_MS) },
    },
    orderBy: { updatedAt: "asc" },
    take: MAX_PAYMENTS_PER_RUN,
  });

  let drift = 0;
  for (const p of stale) {
    try {
      const finding = await inspectPayment(p);
      if (!finding) continue;
      drift++;
      await audit({
        action: "reconcile.payment_drift",
        target: p.id,
        metadata: { reference: p.reference, localStatus: p.status, ...finding },
      });
      await enqueueSettle(p.id); // idempotent (jobId = paymentId-status)
    } catch (err) {
      console.error("[reconcile] payment check failed", {
        paymentId: p.id,
        error: (err as Error).message,
      });
      captureException(err, { source: "reconcile", paymentId: p.id, status: p.status });
    }
  }

  return { checked: stale.length, drift };
}

type Finding = { railKind: "trade" | "payout" | "none"; railState: string } | null;

async function inspectPayment(p: {
  status: PaymentStatus;
  pdaxTradeRef: string | null;
  pdaxCashoutRef: string | null;
}): Promise<Finding> {
  if (p.status === PaymentStatus.PDAX_TRADING && p.pdaxTradeRef) {
    const s = await rail.getTradeStatus(p.pdaxTradeRef);
    // Rail is terminal but we're still PDAX_TRADING → local is behind.
    return s.state === "PENDING" ? null : { railKind: "trade", railState: s.state };
  }
  if (p.status === PaymentStatus.PAYOUT_SUBMITTED && p.pdaxCashoutRef) {
    const s = await rail.getPayoutStatus(p.pdaxCashoutRef);
    return s.state === "PENDING" ? null : { railKind: "payout", railState: s.state };
  }
  // STELLAR_CONFIRMED / PDAX_TRADED / REFUND_PENDING with no advance: stuck job.
  return { railKind: "none", railState: "stuck" };
}
