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
    res = new NextResponse("Forbidden", { status: 403 });
  } else {
    res = NextResponse.next();
  }

  // Security headers on EVERY response (allow/redirect/forbidden alike).
  applySecurityHeaders(res, pathname);
  return res;
}

export const config = {
  // Run on all paths except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
