import "server-only";
import { forbidden } from "@/lib/errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function assertSameOrigin(req: Request): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;

  // Preferred signal: the browser-set Sec-Fetch-Site (cannot be forged by page JS).
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "same-site") return;
  if (site === "cross-site") throw forbidden("Cross-origin request blocked");

  // Fallback (site is null/"none"): compare Origin against APP_URL.
  const origin = req.headers.get("origin");
  if (!origin) throw forbidden("Missing Origin on state-changing request");

  const appUrl = process.env.APP_URL ?? "";
  try {
    if (new URL(origin).origin !== new URL(appUrl).origin) {
      throw forbidden("Origin not allowed");
    }
  } catch {
    throw forbidden("Invalid Origin");
  }
}
