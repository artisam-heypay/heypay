// src/server/observability/error-tracking.ts
//
// Error tracking (SPEC §10 "error tracking (e.g. Sentry)"). Dependency-free:
// every capture is structured-logged; if SENTRY_DSN is set, the event is also
// shipped to Sentry's ingest endpoint (envelope protocol) on a best-effort
// basis. With no DSN it degrades to logging only, so dev/CI need no Sentry.
//
// captureException never throws and never blocks the caller on the network —
// failures to report must not turn into failures of the thing being reported.

type Context = Record<string, unknown>;

const DSN = process.env.SENTRY_DSN?.trim();
const ENVIRONMENT = process.env.NODE_ENV ?? "development";
const SEND_TIMEOUT_MS = 3_000;

type ParsedDsn = { endpoint: string; publicKey: string };

/** Parse `https://<key>@<host>/<projectId>` into the envelope endpoint + key. */
function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, "");
    if (!u.username || !projectId) return null;
    return {
      endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
      publicKey: u.username,
    };
  } catch {
    return null;
  }
}

const parsedDsn = DSN ? parseDsn(DSN) : null;

function eventId(): string {
  // Sentry wants a 32-char hex event id (UUID without dashes).
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
}

async function sendToSentry(err: Error, context: Context, id: string): Promise<void> {
  if (!parsedDsn) return;
  const nowSec = Date.now() / 1000;
  const event = {
    event_id: id,
    timestamp: nowSec,
    platform: "node",
    level: "error",
    environment: ENVIRONMENT,
    server_name: process.env.RAILWAY_SERVICE_NAME ?? "heypay",
    exception: {
      values: [{ type: err.name, value: err.message, stacktrace: undefined }],
    },
    extra: context,
  };
  const envelope =
    JSON.stringify({ event_id: id, sent_at: new Date().toISOString(), dsn: DSN }) +
    "\n" +
    JSON.stringify({ type: "event" }) +
    "\n" +
    JSON.stringify(event) +
    "\n";

  const res = await fetch(parsedDsn.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsedDsn.publicKey}, sentry_client=heypay/1.0`,
    },
    body: envelope,
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error("[error-tracking] sentry ingest rejected", { status: res.status, id });
  }
}

/**
 * Report an exception. Always logs; forwards to Sentry when SENTRY_DSN is set.
 * Fire-and-forget on the network — safe to `void captureException(...)`.
 */
export function captureException(err: unknown, context: Context = {}): string {
  const error = toError(err);
  const id = eventId();
  // Structured log is the source of truth (works with any log aggregator).
  console.error("[error-tracking]", {
    eventId: id,
    name: error.name,
    message: error.message,
    ...context,
  });
  if (parsedDsn) {
    void sendToSentry(error, context, id).catch((sendErr) => {
      console.error("[error-tracking] failed to ship to sentry", {
        id,
        error: (sendErr as Error).message,
      });
    });
  }
  return id;
}

/** True when a real Sentry DSN is configured (useful for health/status). */
export function errorTrackingEnabled(): boolean {
  return parsedDsn !== null;
}
