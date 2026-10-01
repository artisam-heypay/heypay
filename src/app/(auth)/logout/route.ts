// GET /logout → redirect to /login WITHOUT touching the session.
//
// This route used to destroy the session on GET. That is unsafe: browsers,
// prerenderers, and link-prefetching extensions issue GETs with cookies for
// anchors that are merely present in the DOM — each one silently logged the
// user out, which surfaced as "every click bounces me to the login page".
// State changes live in POST-only paths: the logoutAction server action
// (used by LogoutButton) and POST /api/auth/logout. A GET here can only be
// a stale bookmark or a prefetch, so it must stay side-effect-free.
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  // Behind a proxy (Railway) the public host arrives via x-forwarded-host; prefer it so the
  // redirect targets the real domain even when APP_URL is misconfigured to localhost. Local dev
  // has no forwarded header, so it falls back to APP_URL (http://localhost:3000) unchanged.
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  const base = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : (process.env.APP_URL ?? req.url);
  return NextResponse.redirect(new URL("/login", base));
}
