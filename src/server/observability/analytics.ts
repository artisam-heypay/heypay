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

async function send(event: string, distinctId: string, properties: Properties): Promise<void> {
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
  if (!KEY) return;
  void send(event, distinctId, properties).catch((err) => {
    console.error("[analytics] failed to ship to posthog", {
      event,
      error: (err as Error).message,
    });
  });
}

/** True when a PostHog key is configured. */
export function analyticsEnabled(): boolean {
  return Boolean(KEY);
}
