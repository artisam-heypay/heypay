import type { Instrumentation } from "next";

// Copies server console output to PostHog Logs. Edge has no Node APIs, and the
// worker process starts its own shipper.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLogShipping } = await import("@/server/observability/logs");
  startLogShipping("heypay-web");
}

// Next calls this for errors that escape a page, layout, server action, route
// handler or the proxy. API routes wrapped in route() catch their own errors, so
// this mostly covers server-rendered pages. The query string is dropped because
// it can carry tokens.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { captureException } = await import("@/server/observability/error-tracking");
  captureException(err, {
    source: "request",
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    digest: (err as { digest?: string } | null)?.digest,
  });
};
