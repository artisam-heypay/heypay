"use client";
import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";

// Browser analytics (pageviews, autocapture, session replay, error tracking). With no
// NEXT_PUBLIC_POSTHOG_KEY nothing is initialized, so dev/CI send nothing.
//
// Requests go to /ingest on our own origin (rewritten to PostHog in
// next.config.ts), so the CSP keeps connect-src 'self' and ad blockers that
// block posthog.com do not drop events.
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
const UI_HOST = process.env.NEXT_PUBLIC_POSTHOG_UI_HOST?.trim() || "https://us.posthog.com";

// Pages that show wallet funding details, account or bank settings, the camera
// feed, or other users' data (admin) are never recorded.
const NO_REPLAY_PREFIXES = [
  "/payer/prefund",
  "/payer/settings",
  "/payer/scan",
  "/merchant/settings",
  "/merchant/onboarding",
  "/admin",
];

export function replayAllowed(pathname: string): boolean {
  return !NO_REPLAY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const MONITORED_ROLES = new Set(["PAYER", "MERCHANT", "ADMIN"]);

// Idempotent. Called from every effect rather than once in the provider because
// React runs child effects first, so AnalyticsIdentify can fire before the
// provider's own effect would have initialized PostHog.
function ensureAnalytics(): boolean {
  if (!KEY) return false;
  if (!posthog.__loaded) {
    posthog.init(KEY, {
      api_host: "/ingest",
      ui_host: UI_HOST,
      defaults: "2026-08-30",
      person_profiles: "identified_only",
      // Uncaught errors and unhandled promise rejections become $exception
      // events. Errors React catches in an error boundary are reported by
      // captureClientException from app/error.tsx and app/global-error.tsx.
      capture_exceptions: true,
      // Session replay starts only once the path check below allows it.
      disable_session_recording: true,
      session_recording: { maskAllInputs: true },
    });
  }
  return true;
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!ensureAnalytics()) return;
    if (replayAllowed(pathname)) posthog.startSessionRecording();
    else posthog.stopSessionRecording();
  }, [pathname]);

  return children;
}

/**
 * Links events to the signed-in payer, merchant or admin. The distinct id is the
 * internal user id; the username is stored as a person property so PostHog can
 * show it as the display name (never email, wallet or bank details). An unknown
 * role is never identified, and an identity left over in this browser is cleared.
 */
export function AnalyticsIdentify({
  userId,
  role,
  username,
}: {
  userId: string;
  role: string;
  username: string;
}) {
  useEffect(() => {
    if (!ensureAnalytics()) return;
    if (!MONITORED_ROLES.has(role)) {
      const identified = posthog.get_property("role") || posthog.get_distinct_id() === userId;
      if (identified) posthog.reset();
      return;
    }
    posthog.register({ role });
    if (posthog.get_distinct_id() !== userId) posthog.identify(userId, { role, username });
    // Also covers users identified before the username was sent; posthog-js
    // skips the request when the properties have not changed.
    else posthog.setPersonProperties({ role, username });
  }, [userId, role, username]);
  return null;
}

/** Report an error caught by a React error boundary to PostHog error tracking. */
export function captureClientException(error: Error & { digest?: string }): void {
  if (!ensureAnalytics()) return;
  posthog.captureException(error, { source: "error-boundary", digest: error.digest });
}

/** Clears the identity so the next person on this browser is not merged in. */
export function resetAnalytics(): void {
  if (KEY && posthog.__loaded) posthog.reset();
}
