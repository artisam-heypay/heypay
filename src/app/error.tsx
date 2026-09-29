"use client";
import { useEffect } from "react";
import { captureClientException } from "@/components/analytics/PostHogProvider";

// Any page that throws while rendering lands here. The error goes to PostHog
// error tracking; the user sees a retry instead of a blank screen.
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    captureClientException(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-stack-lg p-margin-mobile">
      <h1 className="text-headline-lg font-display text-primary">Something went wrong</h1>
      <p className="text-body-lg text-on-surface-variant">
        This page hit an error and we have been notified. Try again, and if it keeps happening,
        contact support.
      </p>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="rounded-full bg-primary py-4 text-headline-md font-display text-on-primary shadow-lg shadow-primary/20 transition hover:brightness-110 active:scale-95 focus:ring-4 focus:ring-primary/10"
      >
        Try again
      </button>
    </main>
  );
}
