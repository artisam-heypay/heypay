// GET /api/auth/google/start[?role=PAYER|MERCHANT]
//
// Sends the browser to Google's account chooser. The sign-up page passes the
// role the person picked; the sign-in page passes none. Reached by a plain link
// rather than a form, because the CSP's `form-action 'self'` would block a form
// that ends up at accounts.google.com.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clientIp } from "@/lib/net";
import { rateLimit } from "@/server/auth/rate-limit";
import {
  googleAuthUrl,
  googleConfig,
  newOAuthFlow,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  OAUTH_COOKIE_TTL_SEC,
} from "@/server/auth/google";

const seeOther = (location: string) =>
  new NextResponse(null, { status: 303, headers: { location } });

export async function GET(req: NextRequest): Promise<NextResponse> {
  const roleParam = req.nextUrl.searchParams.get("role");
  const role = roleParam === "PAYER" || roleParam === "MERCHANT" ? roleParam : null;
  const back = role ? "/signup" : "/login";

  const config = googleConfig();
  if (!config) return seeOther(`${back}?error=google_unavailable`);
  try {
    await rateLimit(`google:ip:${clientIp(req)}`, { limit: 30, windowSec: 900 });
  } catch {
    return seeOther(`${back}?error=too_many_attempts`);
  }

  const flow = newOAuthFlow(role);
  // Lax, so the cookie comes back on the top-level redirect from Google.
  (await cookies()).set(OAUTH_COOKIE, JSON.stringify(flow), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_TTL_SEC,
  });
  return seeOther(googleAuthUrl(config, flow));
}
