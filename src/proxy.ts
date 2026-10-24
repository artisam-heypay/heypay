import { NextRequest, NextResponse } from "next/server";
import { lookupSession, SESSION_COOKIE } from "@/server/auth/sessions";
import { evaluateAccess } from "@/lib/route-roles";
import { applySecurityHeaders } from "@/lib/security-headers";

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await lookupSession(token);
  const decision = evaluateAccess(pathname, user?.role ?? null);

  let res: NextResponse;
  if (decision === "login") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    res = NextResponse.redirect(url);
  } else if (decision === "forbidden") {
    // The branded page, with a way back to the account's own dashboard; the
    // address bar keeps the URL that was asked for.
    res = NextResponse.rewrite(new URL("/403", req.url), { status: 403 });
  } else {
    res = NextResponse.next();
  }

  // Security headers on EVERY response (allow/redirect/forbidden alike).
  applySecurityHeaders(res);
  return res;
}

export const config = {
  // Run on all paths except Next internals, static assets, and the PostHog
  // ingest rewrite (public, high-volume; no session lookup needed).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|ingest/).*)"],
};
