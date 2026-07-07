import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Role } from "@/generated/prisma/client";
import { AppError, badRequest, serverError, type ErrorEnvelope } from "./errors";
import { captureException } from "@/server/observability/error-tracking";

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
      const body: ErrorEnvelope = appErr.toEnvelope();
      return NextResponse.json(body, { status: appErr.status });
    }
  };
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
