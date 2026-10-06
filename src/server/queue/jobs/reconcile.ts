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
import { enabledAssets } from "@/lib/assets";
import { isAssetConfigured } from "@/server/stellar/assets";
import { getAssetBalances } from "@/server/wallet/balances";

// A settle job advances an in-flight payment within seconds; a payment sitting in
// a mid-settlement state longer than this means its worker job was lost, or the
// rail moved on without us. Reconcile re-checks the rail and re-drives it.
const STALE_MS = 2 * 60_000;
// Cap rail calls per run so one reconcile tick can't stampede Xendit.
const MAX_PAYMENTS_PER_RUN = 50;

// A payout carries a Xendit reference we can authoritatively diff against. This
// is also the fallback for a missed Xendit webhook.
const PAYOUT_STATES: PaymentStatus[] = [PaymentStatus.PAYOUT_SUBMITTED];
// In-flight states with no fresh rail ref to poll — a stuck one just needs the
// worker to resume (re-enqueue drives STELLAR_CONFIRMED→payout, REFUND_PENDING→refund).
// Escrowed payments resume the same way: a paid payout whose escrow release
// failed stays PAYOUT_SUBMITTED, and an unfinished escrow refund stays
// REFUND_PENDING, so the settle job retries the contract call.
const STUCK_STATES: PaymentStatus[] = [
  PaymentStatus.STELLAR_CONFIRMED,
  PaymentStatus.REFUND_PENDING,
];
const IN_FLIGHT: PaymentStatus[] = [...PAYOUT_STATES, ...STUCK_STATES];

export type ReconcileResult = {
  checked: number; // wallets checked (XLM leg)
  drift: number; // wallets whose cached balance differed from Horizon
  paymentsChecked: number; // stale in-flight payments inspected (PHP payout leg)
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

// Crypto leg: diff each custodial wallet's cached balances against Horizon, for
// every enabled asset — an untracked USDT balance is as much a discrepancy as an
// untracked XLM one. A wallet with drift in two assets counts once.
async function reconcileWallets(): Promise<{ checked: number; drift: number }> {
  const wallets = await db.custodialWallet.findMany();
  const assets = enabledAssets().filter(isAssetConfigured);
  let drift = 0;

  for (const wallet of wallets) {
    let onChain;
    try {
      onChain = await walletService.getBalances(wallet.stellarPublicKey, assets);
    } catch (err) {
      console.error("[reconcile] getBalances failed", {
        walletId: wallet.id,
        error: (err as Error).message,
      });
      continue;
    }
    const cachedBalances = await getAssetBalances(db, wallet.id, assets);
    let walletDrifted = false;

    for (const { asset, balance } of onChain) {
      const cached = cachedBalances.find((b) => b.asset === asset)?.cached ?? dec("0");
      if (cached.equals(balance)) continue;
      walletDrifted = true;
      await audit({
        action: "reconcile.drift",
        target: wallet.id,
        metadata: {
          publicKey: wallet.stellarPublicKey,
          asset,
          cached: cached.toFixed(7),
          horizon: balance.toFixed(7),
          delta: balance.minus(cached).toFixed(7),
        },
      });
    }
    if (walletDrifted) drift++;
  }

  return { checked: wallets.length, drift };
}

// PHP payout leg: for each stale in-flight payment, ask the rail where it actually
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
        metadata: {
          reference: p.reference,
          localStatus: p.status,
          asset: p.asset,
          ...finding,
          ...(p.escrowJobId && { escrowJobId: p.escrowJobId }),
        },
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

type Finding = { railKind: "payout" | "none"; railState: string } | null;

async function inspectPayment(p: {
  status: PaymentStatus;
  payoutRef: string | null;
}): Promise<Finding> {
  if (p.status === PaymentStatus.PAYOUT_SUBMITTED && p.payoutRef) {
    const s = await rail.getPayoutStatus(p.payoutRef);
    // Xendit is terminal but we're still PAYOUT_SUBMITTED → local is behind.
    return s.state === "PENDING" ? null : { railKind: "payout", railState: s.state };
  }
  // STELLAR_CONFIRMED / REFUND_PENDING with no advance: stuck job.
  return { railKind: "none", railState: "stuck" };
}
