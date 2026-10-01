// src/worker/index.ts
import "dotenv/config"; // standalone Node process — load .env before anything reads env
import "server-only";
import { Worker } from "bullmq";
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
import { captureException } from "@/server/observability/error-tracking";

async function main() {
  // Bucket bootstrap (MinIO dev / S3 prod). Non-fatal: settlement/deposit/reconcile jobs
  // don't touch object storage, so a transient S3 outage at boot must not kill the worker.
  try {
    await ensureBucket();
  } catch (err) {
    console.error("[worker] ensureBucket failed (continuing; uploads may be degraded)", err);
  }

  const settleWorker = new Worker(
    QUEUE_NAMES.settle,
    async (job) => {
      await processSettleJob({ data: job.data as { paymentId: string } });
    },
    { connection: bullConnection, concurrency: 5 },
  );
  const depositWorker = new Worker(
    QUEUE_NAMES.depositPoll,
    async () => {
      await processDepositPollJob();
    },
    { connection: bullConnection, concurrency: 1 },
  );
  const reconcileWorker = new Worker(
    QUEUE_NAMES.reconcile,
    async () => {
      await processReconcileJob();
    },
    { connection: bullConnection, concurrency: 1 },
  );

  for (const w of [settleWorker, depositWorker, reconcileWorker]) {
    w.on("failed", (job, err) => {
      console.error(`[worker] ${w.name} job ${job?.id} failed`, err.message);
      captureException(err, {
        source: "worker",
        queue: w.name,
        jobId: job?.id,
        paymentId: (job?.data as { paymentId?: string } | undefined)?.paymentId,
      });
    });
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
