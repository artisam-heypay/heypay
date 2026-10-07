// src/server/auth/google.ts
//
// "Continue with Google": OpenID Connect authorization-code flow with PKCE,
// done server-side with plain fetch. The browser only ever follows redirects;
// the client secret and the tokens stay here.
//
// The ID token is read without checking its signature. That is the case the
// OpenID Connect spec allows (Core §3.1.3.7): the token comes straight from
// Google's token endpoint over TLS, in answer to a request authenticated with
// our client secret, so nobody else can have supplied it. Its issuer, audience,
// expiry and nonce are still checked.
import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import type { User } from "@/generated/prisma/client";
import { createVerifiedAccount, normalizeEmail, type SignupRole } from "./accounts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const TOKEN_TIMEOUT_MS = 10_000;

export const OAUTH_COOKIE = "heypay_oauth" as const;
export const OAUTH_COOKIE_PATH = "/api/auth/google";
export const OAUTH_COOKIE_TTL_SEC = 10 * 60;

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

/** Null when Google sign-in is not set up; the buttons are hidden and the routes refuse. */
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (!clientId || !clientSecret || !appUrl) return null;
  // Must match an "Authorized redirect URI" on the Google OAuth client exactly.
  return { clientId, clientSecret, redirectUri: `${appUrl}/api/auth/google/callback` };
}

export function googleEnabled(): boolean {
  return googleConfig() !== null;
}

/** What the start route keeps in a cookie until Google sends the browser back. */
export const oauthFlowSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  verifier: z.string().min(1),
  // Set when the flow started on the sign-up page; a sign-in carries none.
  role: z.enum(["PAYER", "MERCHANT"]).nullable(),
});
export type OAuthFlow = z.infer<typeof oauthFlowSchema>;

export function newOAuthFlow(role: SignupRole | null): OAuthFlow {
  const random = () => randomBytes(32).toString("base64url");
  return { state: random(), nonce: random(), verifier: random(), role };
}

export function googleAuthUrl(config: GoogleConfig, flow: OAuthFlow): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: createHash("sha256").update(flow.verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

const idTokenSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
  sub: z.string().min(1),
  nonce: z.string().optional(),
  email: z.string().email(),
  email_verified: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
});

export type GoogleProfile = { sub: string; email: string; emailVerified: boolean };

/** Why a Google sign-in could not be completed. The message is for the server log. */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/** Swaps the one-time code from the callback for the signed-in Google account. */
export async function exchangeGoogleCode(
  config: GoogleConfig,
  input: { code: string; verifier: string; nonce: string },
  fetchImpl: FetchImpl = (url, init) => fetch(url, init),
): Promise<GoogleProfile> {
  let res: Response;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        code_verifier: input.verifier,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch {
    throw new GoogleAuthError("token request did not complete");
  }
  if (!res.ok) throw new GoogleAuthError(`token endpoint answered ${res.status}`);

  const token = tokenResponseSchema.safeParse(await res.json().catch(() => null));
  if (!token.success) throw new GoogleAuthError("token response had no id_token");

  const payload = token.data.id_token.split(".")[1];
  let claims: unknown = null;
  try {
    claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8"));
  } catch {
    // falls through to the schema check below
  }
  const parsed = idTokenSchema.safeParse(claims);
  if (!parsed.success) throw new GoogleAuthError("id_token claims were not readable");

  const { iss, aud, exp, sub, nonce, email, email_verified } = parsed.data;
  if (!ISSUERS.has(iss)) throw new GoogleAuthError("id_token has the wrong issuer");
  if (aud !== config.clientId) throw new GoogleAuthError("id_token is for another client");
  if (exp * 1000 < Date.now()) throw new GoogleAuthError("id_token has expired");
  if (!nonce || !sameSecret(nonce, input.nonce)) {
    throw new GoogleAuthError("id_token nonce does not match");
  }
  return {
    sub,
    email: normalizeEmail(email),
    emailVerified: email_verified === true || email_verified === "true",
  };
}

export type GoogleSignIn =
  | { kind: "signed_in"; user: User; created: boolean }
  /** No HeyPay account yet and no role to create one with: send them to sign-up. */
  | { kind: "no_account" }
  | { kind: "inactive" };

/**
 * Finds or creates the HeyPay account for a Google account whose email Google
 * has verified. `role` is what the person picked on the sign-up page, if the
 * flow started there.
 */
export async function resolveGoogleAccount(
  profile: GoogleProfile,
  role: SignupRole | null,
): Promise<GoogleSignIn> {
  const linked = await db.user.findUnique({ where: { googleSub: profile.sub } });
  if (linked) {
    return linked.isActive
      ? { kind: "signed_in", user: linked, created: false }
      : { kind: "inactive" };
  }

  const byEmail = await db.user.findUnique({ where: { email: profile.email } });
  if (byEmail) {
    if (!byEmail.isActive) return { kind: "inactive" };
    // Same person on both sides: HeyPay confirmed this address with a code
    // before the account existed, and Google vouches for it now. From here on
    // the account opens with its password or with Google.
    const user = await db.user.update({
      where: { id: byEmail.id },
      data: { googleSub: profile.sub },
    });
    return { kind: "signed_in", user, created: false };
  }

  if (!role) return { kind: "no_account" };
  const user = await db.$transaction((tx) =>
    createVerifiedAccount(tx, { email: profile.email, role, googleSub: profile.sub }),
  );
  return { kind: "signed_in", user, created: true };
}
