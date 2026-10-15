// src/server/queue/queues.ts
import "server-only";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { db } from "@/server/db";

export const QUEUE_NAMES = {
  settle: "settle",
  depositPoll: "deposit-poll",
  reconcile: "reconcile",
  walletActivate: "wallet-activate",
} as const;

// BullMQ requires maxRetriesPerRequest: null on the shared connection.
export const bullConnection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

const defaultJobOpts = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 2_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

export const settleQueue = new Queue(QUEUE_NAMES.settle, {
  connection: bullConnection,
  defaultJobOptions: defaultJobOpts,
});
export const depositPollQueue = new Queue(QUEUE_NAMES.depositPoll, {
  connection: bullConnection,
  defaultJobOptions: defaultJobOpts,
});
export const reconcileQueue = new Queue(QUEUE_NAMES.reconcile, {
  connection: bullConnection,
  defaultJobOptions: defaultJobOpts,
});
export const walletActivateQueue = new Queue(QUEUE_NAMES.walletActivate, {
  connection: bullConnection,
  defaultJobOptions: defaultJobOpts,
});

export async function enqueueSettle(
  paymentId: string,
  opts: { delayMs?: number } = {},
): Promise<void> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: { status: true },
  });
  if (!payment) return;
  // Separator is "-" not ":" — BullMQ forbids ":" in a custom jobId (its internal key delimiter).
  const stepId = `${paymentId}-${payment.status}`;

  if (opts.delayMs) {
    // A scheduled re-check (e.g. a payout still pending at Xendit). It gets its own id:
    // it is usually requested from inside the job that holds `stepId`.
    await settleQueue.add(
      "settle",
      { paymentId },
      { jobId: `${stepId}-at${Date.now() + opts.delayMs}`, delay: opts.delayMs },
    );
    return;
  }

  // jobId ties the job to (payment, status) so a duplicate of a queued or running step
  // is dropped. BullMQ also drops an id it has *finished*, which would silently swallow
  // every later nudge for a step that can be re-checked (PAYOUT_SUBMITTED waiting on
  // Xendit, a REFUND_PENDING retry) — so a finished job is cleared to make room.
  const existing = await settleQueue.getJob(stepId);
  if (existing) {
    const state = await existing.getState();
    if (state !== "completed" && state !== "failed") return; // already queued or running
    await existing.remove();
  }
  await settleQueue.add("settle", { paymentId }, { jobId: stepId });
}

/**
 * Queue the sponsored activation of a payer's new custodial wallet (see
 * jobs/wallet-activate.ts). Sign-up goes through requestWalletActivation in
 * @/server/wallet/activation, which decides whether there is anything to queue.
 */
export async function enqueueWalletActivation(userId: string): Promise<void> {
  // jobId drops a second request for the same payer.
  await walletActivateQueue.add("activate", { userId }, { jobId: userId });
}
