// GET /api/auth/google/callback?code=…&state=…
//
// Where Google sends the browser back. Signs the person in, or creates their
// account when the flow started on the sign-up page. Every outcome is a
// redirect: this URL is never shown, so failures land on /login or /signup with
// an `error` code those pages turn into a message.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clientIp } from "@/lib/net";
import { dashboardPath } from "@/lib/auth-redirect";
import { audit } from "@/server/auth/audit";
import { createSession } from "@/server/auth/sessions";
import { captureUserEvent } from "@/server/observability/analytics";
import { captureException } from "@/server/observability/error-tracking";
import {
  exchangeGoogleCode,
  googleConfig,
  GoogleAuthError,
  oauthFlowSchema,
  resolveGoogleAccount,
  sameSecret,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  type GoogleConfig,
  type OAuthFlow,
} from "@/server/auth/google";

const seeOther = (location: string) =>
  new NextResponse(null, { status: 303, headers: { location } });

function readFlow(raw: string | undefined): OAuthFlow | null {
  if (!raw) return null;
  try {
    const parsed = oauthFlowSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const store = await cookies();
  const flow = readFlow(store.get(OAUTH_COOKIE)?.value);
  // One use only, whatever happens next. Same path as it was set with, or the
  // browser keeps it.
  store.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });

  const back = flow?.role ? "/signup" : "/login";
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return seeOther(`${back}?error=google_cancelled`);

  const config = googleConfig();
  if (!config) return seeOther(`${back}?error=google_unavailable`);

  const code = params.get("code");
  const state = params.get("state");
  // The state proves this browser started the flow it is now finishing.
  if (!flow || !code || !state || !sameSecret(state, flow.state)) {
    return seeOther(`${back}?error=google_failed`);
  }

  const ip = clientIp(req);
  try {
    return await finish(req, flow, config, code, ip);
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      console.error("[google]", err.message);
      await audit({ action: "auth.login.failed", metadata: { method: "google" }, ip });
    } else {
      // A blank 500 at this URL would strand the person mid sign-in.
      captureException(err, { source: "route", method: "GET", path: req.nextUrl.pathname });
    }
    return seeOther(`${back}?error=google_failed`);
  }
}

async function finish(
  req: NextRequest,
  flow: OAuthFlow,
  config: GoogleConfig,
  code: string,
  ip: string,
): Promise<NextResponse> {
  const back = flow.role ? "/signup" : "/login";
  const profile = await exchangeGoogleCode(config, {
    code,
    verifier: flow.verifier,
    nonce: flow.nonce,
  });
  if (!profile.emailVerified) return seeOther(`${back}?error=google_unverified`);

  const result = await resolveGoogleAccount(profile, flow.role);
  if (result.kind === "no_account") return seeOther("/signup?error=google_no_account");
  if (result.kind === "inactive") return seeOther("/login?error=account_inactive");

  const { user, created } = result;
  await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
  await audit({
    actorId: user.id,
    action: created ? "auth.signup" : "auth.login",
    target: user.id,
    metadata: { method: "google" },
    ip,
  });
  captureUserEvent(created ? "user_signed_up" : "user_logged_in", user, { method: "google" });
  return seeOther(dashboardPath(user.role));
}
