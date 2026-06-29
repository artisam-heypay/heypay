import "server-only";
import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { db } from "@/server/db";

export const QUEUE_NAMES = {
  settle: "settle",
  depositPoll: "deposit-poll",
  reconcile: "reconcile",
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
  connection: bullConnection as unknown as ConnectionOptions,
  defaultJobOptions: defaultJobOpts,
});
export const depositPollQueue = new Queue(QUEUE_NAMES.depositPoll, {
  connection: bullConnection as unknown as ConnectionOptions,
  defaultJobOptions: defaultJobOpts,
});
export const reconcileQueue = new Queue(QUEUE_NAMES.reconcile, {
  connection: bullConnection as unknown as ConnectionOptions,
  defaultJobOptions: defaultJobOpts,
});

export async function enqueueSettle(paymentId: string): Promise<void> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: { status: true },
  });
  if (!payment) return;
  // jobId ties the job to (payment, status); BullMQ dedupes a duplicate of the same step.
  await settleQueue.add("settle", { paymentId }, { jobId: `${paymentId}:${payment.status}` });
}
