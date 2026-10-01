// src/server/observability/logs.ts
//
// Server logs to PostHog Logs over OTLP/HTTP (JSON encoding). Dependency-free,
// same contract as analytics: with no NEXT_PUBLIC_POSTHOG_KEY nothing is sent,
// and shipping never throws or blocks the code that logged.
//
// console.log/info/warn/error/debug keep printing as before; each call is also
// queued and sent in batches. The web app and the worker each start this once
// with their own service name, so logs can be filtered by service in PostHog.

import { format } from "node:util";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
const HOST = (process.env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(/\/+$/, "");
const ENVIRONMENT = process.env.NODE_ENV ?? "development";
const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH = 200;
// A PostHog outage must not grow memory without bound; the oldest lines go first.
const MAX_QUEUED = 2_000;
const MAX_BODY_CHARS = 8_000;
const SEND_TIMEOUT_MS = 5_000;

type Level = "debug" | "log" | "info" | "warn" | "error";

// OTLP severity numbers: DEBUG=5, INFO=9, WARN=13, ERROR=17.
const SEVERITY: Record<Level, { number: number; text: string }> = {
  debug: { number: 5, text: "DEBUG" },
  log: { number: 9, text: "INFO" },
  info: { number: 9, text: "INFO" },
  warn: { number: 13, text: "WARN" },
  error: { number: 17, text: "ERROR" },
};

type LogRecord = {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
};

// The unpatched console, so shipping failures are printed without being
// shipped again.
const original = {
  debug: console.debug,
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

let queue: LogRecord[] = [];
let serviceName = "heypay";
let started = false;
let inFlight: Promise<void> = Promise.resolve();

/** Build one OTLP log record from console arguments. */
export function toLogRecord(level: Level, args: unknown[], now = Date.now()): LogRecord {
  const text = format(...args);
  return {
    timeUnixNano: (BigInt(now) * 1_000_000n).toString(),
    severityNumber: SEVERITY[level].number,
    severityText: SEVERITY[level].text,
    body: {
      stringValue: text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…` : text,
    },
  };
}

function enqueue(record: LogRecord): void {
  queue.push(record);
  if (queue.length > MAX_QUEUED) queue = queue.slice(queue.length - MAX_QUEUED);
  if (queue.length >= MAX_BATCH) void flushLogs();
}

async function send(records: LogRecord[]): Promise<void> {
  const res = await fetch(`${HOST}/i/v1/logs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: serviceName } },
              { key: "deployment.environment", value: { stringValue: ENVIRONMENT } },
            ],
          },
          scopeLogs: [{ scope: { name: "heypay" }, logRecords: records }],
        },
      ],
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) original.error("[logs] posthog rejected logs", { status: res.status });
}

/** Send everything queued so far. Never throws. */
export function flushLogs(): Promise<void> {
  if (!KEY || queue.length === 0) return inFlight;
  const batch = queue.splice(0, MAX_BATCH);
  inFlight = inFlight
    .then(() => send(batch))
    .catch((err) => {
      original.error("[logs] failed to ship to posthog", { error: (err as Error).message });
    });
  return inFlight;
}

/**
 * Start copying console output to PostHog Logs under `service`. Idempotent;
 * does nothing without a PostHog key.
 */
export function startLogShipping(service: string): void {
  if (!KEY || started) return;
  started = true;
  serviceName = service;

  for (const level of Object.keys(original) as Level[]) {
    console[level] = (...args: unknown[]) => {
      original[level](...args);
      try {
        enqueue(toLogRecord(level, args));
      } catch {
        // Logging must keep working even if a record cannot be built.
      }
    };
  }

  setInterval(() => void flushLogs(), FLUSH_INTERVAL_MS).unref();
  process.once("beforeExit", () => void flushLogs());
}
