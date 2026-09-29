// src/server/observability/analytics.ts
//
// Product analytics from the server (PostHog capture API). Dependency-free,
// same contract as error-tracking: with no NEXT_PUBLIC_POSTHOG_KEY nothing is
// sent, and capture never throws or blocks the caller on the network — a
// failed analytics call must not fail the payment it describes.
//
// The web app and the worker both call this, so funnel events arrive even for
// steps that run in background jobs, and ad blockers cannot drop them.

type Properties = Record<string, string | number | boolean | null | undefined>;

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
const HOST = (process.env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(/\/+$/, "");
const ENVIRONMENT = process.env.NODE_ENV ?? "development";
const SEND_TIMEOUT_MS = 3_000;

async function send(
  event: string,
  distinctId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${HOST}/i/v0/e/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: KEY,
      event,
      distinct_id: distinctId,
      timestamp: new Date().toISOString(),
      properties: { ...properties, environment: ENVIRONMENT, $lib: "heypay-server" },
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) console.error("[analytics] posthog capture rejected", { status: res.status, event });
}

/**
 * Record an event for a user (distinctId = internal user id, never a username,
 * email, wallet address or bank detail). Fire-and-forget.
 */
export function captureEvent(event: string, distinctId: string, properties: Properties = {}): void {
  captureRawEvent(event, distinctId, properties);
}

/**
 * Like captureEvent, but properties may be nested (PostHog's `$exception_list`).
 * Only error-tracking should need this. Fire-and-forget.
 */
export function captureRawEvent(
  event: string,
  distinctId: string,
  properties: Record<string, unknown>,
): void {
  if (!KEY) return;
  void send(event, distinctId, properties).catch((err) => {
    console.error("[analytics] failed to ship to posthog", {
      event,
      error: (err as Error).message,
    });
  });
}

/** The signed-in user an event is about. */
export type AnalyticsActor = { id: string; role: string };

const MONITORED_ROLES = new Set(["PAYER", "MERCHANT", "ADMIN"]);

/**
 * Record an event for a signed-in payer, merchant or admin. Adds `role` to every
 * event so PostHog can split behavior by role; any other role is dropped.
 */
export function captureUserEvent(
  event: string,
  actor: AnalyticsActor,
  properties: Properties = {},
): void {
  if (!MONITORED_ROLES.has(actor.role)) return;
  captureEvent(event, actor.id, { ...properties, role: actor.role });
}

/** Replace id-like path segments so API paths group together in PostHog. */
export function normalizeApiPath(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) => (/^[a-z0-9]{20,}$/i.test(seg) || /^[0-9a-f-]{32,36}$/i.test(seg) ? ":id" : seg))
    .join("/");
}

/** True when a PostHog key is configured. */
export function analyticsEnabled(): boolean {
  return Boolean(KEY);
}
