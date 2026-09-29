// src/server/observability/analytics.ts
//
// Product analytics from the server (PostHog capture API). Dependency-free,
// same contract as error-tracking: with no NEXT_PUBLIC_POSTHOG_KEY nothing is
// sent, and capture never throws or blocks the caller on the network — a
// failed analytics call must not fail the payment it describes.
//
// The web app and the worker both call this, so funnel events arrive even for
// steps that run in background jobs, and ad blockers cannot drop them.

import { headers } from "next/headers";

type Properties = Record<string, string | number | boolean | null | undefined>;

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
const HOST = (process.env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(/\/+$/, "");
const ENVIRONMENT = process.env.NODE_ENV ?? "development";
const SEND_TIMEOUT_MS = 3_000;

/**
 * Starts reading the request's headers. Must run synchronously inside the
 * request, before the send is detached. Resolves to null outside a request
 * (worker jobs, tests).
 */
function requestHeaders(): Promise<Headers | null> {
  try {
    return headers().catch(() => null) as Promise<Headers | null>;
  } catch {
    return Promise.resolve(null);
  }
}

/**
 * The page the user was on, taken from the Referer that browsers send with API
 * calls and server actions, so server events show a URL in PostHog like
 * browser events do. The query string and hash are dropped because they can
 * hold tokens. Worker jobs and webhooks have no page, so nothing is added.
 */
export function pageProperties(referer: string | null | undefined): Record<string, string> {
  if (!referer) return {};
  try {
    const url = new URL(referer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return {};
    return { $current_url: `${url.origin}${url.pathname}`, $pathname: url.pathname };
  } catch {
    return {};
  }
}

async function send(
  event: string,
  distinctId: string,
  properties: Record<string, unknown>,
  pendingHeaders: Promise<Headers | null>,
): Promise<void> {
  const page = pageProperties((await pendingHeaders)?.get("referer"));
  const res = await fetch(`${HOST}/i/v0/e/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: KEY,
      event,
      distinct_id: distinctId,
      timestamp: new Date().toISOString(),
      properties: { ...page, ...properties, environment: ENVIRONMENT, $lib: "heypay-server" },
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
  void send(event, distinctId, properties, requestHeaders()).catch((err) => {
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
