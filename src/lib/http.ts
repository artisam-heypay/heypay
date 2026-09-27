import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Role } from "@/generated/prisma/client";
import { AppError, badRequest, serverError, type ErrorEnvelope } from "./errors";
import { captureException } from "@/server/observability/error-tracking";
import {
  analyticsEnabled,
  captureUserEvent,
  normalizeApiPath,
} from "@/server/observability/analytics";

export type HandlerContext = {
  params: Record<string, string>;
  userId: string | null;
  role: Role | null;
};

export type Handler = (req: NextRequest, ctx: HandlerContext) => Promise<NextResponse>;

/** JSON success helper. */
export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof z.ZodError) return badRequest("Validation failed.", err.flatten());
  return serverError();
}

/**
 * Wraps a Route Handler: resolves Next 16 async params, builds the context,
 * catches AppError/ZodError -> ErrorEnvelope + status, logs full detail server-side.
 * (Auth population of userId/role is layered in by Phase 2.)
 */
export function route(
  handler: Handler,
): (req: NextRequest, raw: { params: Promise<Record<string, string>> }) => Promise<NextResponse> {
  return async (req, raw) => {
    try {
      const params = raw?.params ? await raw.params : {};
      const ctx: HandlerContext = { params: params ?? {}, userId: null, role: null };
      return await handler(req, ctx);
    } catch (err) {
      const appErr = toAppError(err);
      if (appErr.status >= 500) {
        // Full detail stays server-side; clients only see the envelope.
        console.error("[route]", appErr.code, appErr.message, err);
        captureException(err, {
          source: "route",
          code: appErr.code,
          method: req.method,
          path: req.nextUrl.pathname,
        });
      }
      await reportApiError(req, appErr);
      const body: ErrorEnvelope = appErr.toEnvelope();
      return NextResponse.json(body, { status: appErr.status });
    }
  };
}

// Payer, merchant and admin APIs; auth (no user yet) and webhooks are not
// monitored here.
const MONITORED_API_PREFIXES = [
  "/api/payments",
  "/api/wallet",
  "/api/qrph",
  "/api/merchant",
  "/api/admin",
];

/**
 * Send a failed payer/merchant/admin API call to analytics as `api_error`, so errors
 * testers hit show up even when nobody reports them. Never throws.
 */
async function reportApiError(req: NextRequest, err: AppError): Promise<void> {
  if (!analyticsEnabled() || err.status === 401) return;
  const path = req.nextUrl.pathname;
  if (!MONITORED_API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return;
  try {
    // Imported lazily: the session module pulls in the database client.
    const { getSessionUser } = await import("@/server/auth/sessions");
    const user = await getSessionUser();
    if (!user) return;
    captureUserEvent("api_error", user, {
      path: normalizeApiPath(path),
      method: req.method,
      status: err.status,
      code: err.code,
      message: err.message.slice(0, 200),
    });
  } catch {
    // Analytics must never change the error response.
  }
}

/** Parse + validate a JSON body with a Zod schema; throws badRequest on failure. */
export async function parseBody<S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw badRequest("Validation failed.", result.error.flatten());
  return result.data;
}

/** Parse + validate query params with a Zod schema; throws badRequest on failure. */
export function parseQuery<S extends z.ZodTypeAny>(req: NextRequest, schema: S): z.infer<S> {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) throw badRequest("Invalid query parameters.", result.error.flatten());
  return result.data;
}
