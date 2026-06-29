import "server-only";
import { Worker, type ConnectionOptions } from "bullmq";
import {
  QUEUE_NAMES,
  bullConnection,
  depositPollQueue,
  reconcileQueue,
} from "@/server/queue/queues";
import { processSettleJob } from "@/server/queue/jobs/settle";
import { processDepositPollJob } from "@/server/queue/jobs/deposit-poller";
import { processReconcileJob } from "@/server/queue/jobs/reconcile";
import { ensureBucket } from "@/server/storage/s3";

async function main() {
  await ensureBucket(); // bucket bootstrap (MinIO dev / S3 prod)

  const settleWorker = new Worker(
    QUEUE_NAMES.settle,
    async (job) => {
      await processSettleJob({ data: job.data as { paymentId: string } });
    },
    { connection: bullConnection as unknown as ConnectionOptions, concurrency: 5 },
  );
  const depositWorker = new Worker(
    QUEUE_NAMES.depositPoll,
    async () => {
      await processDepositPollJob();
    },
    { connection: bullConnection as unknown as ConnectionOptions, concurrency: 1 },
  );
  const reconcileWorker = new Worker(
    QUEUE_NAMES.reconcile,
    async () => {
      await processReconcileJob();
    },
    { connection: bullConnection as unknown as ConnectionOptions, concurrency: 1 },
  );

  for (const w of [settleWorker, depositWorker, reconcileWorker]) {
    w.on("failed", (job, err) =>
      console.error(`[worker] ${w.name} job ${job?.id} failed`, err.message),
    );
  }

  // Repeatable jobs (idempotent processors). jobId keeps a single repeatable schedule.
  await depositPollQueue.add("poll", {}, { repeat: { every: 30_000 }, jobId: "deposit-poll-cron" });
  await reconcileQueue.add(
    "reconcile",
    {},
    { repeat: { every: 5 * 60_000 }, jobId: "reconcile-cron" },
  );

  console.log("[worker] started: settle, deposit-poll, reconcile");

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, shutting down`);
    await Promise.allSettled([
      settleWorker.close(),
      depositWorker.close(),
      reconcileWorker.close(),
    ]);
    await bullConnection.quit();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
