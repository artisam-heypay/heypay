// GET /logout → destroy session then redirect to /login (links can point here safely;
// state change is the session revoke, protected by SameSite=Lax cookie semantics).
import { NextResponse } from "next/server";
import { destroySession } from "@/server/auth/sessions";

export async function GET(req: Request) {
  await destroySession();
  // Behind a proxy (Railway) req.url reflects the internal origin (localhost). Prefer the public
  // host the proxy forwards via x-forwarded-host so the redirect targets the real domain; fall
  // back to APP_URL for local dev (no forwarded header) — http://localhost:3000 unchanged.
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  const base = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : (process.env.APP_URL ?? req.url);
  return NextResponse.redirect(new URL("/login", base));
}
