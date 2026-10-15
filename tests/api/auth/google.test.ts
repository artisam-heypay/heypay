import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cookieJar } from "../../helpers/mock-cookies";
import { resetDb } from "../../helpers/db";
import { NextRequest } from "next/server";

vi.mock("@/server/redis", async () => {
  const { makeFakeRedis } = await import("../../helpers/fake-redis");
  return { redis: makeFakeRedis() };
});
vi.mock("@/server/stellar/wallet", () => ({
  walletService: {
    generate: () => ({ publicKey: "GTEST", encryptedSecret: "v1:enc", secretKeyVersion: 1 }),
  },
}));

import { redis } from "@/server/redis";
import { db } from "@/server/db";
import { SESSION_COOKIE } from "@/server/auth/sessions";
import { OAUTH_COOKIE } from "@/server/auth/google";
import { GET as START } from "@/app/api/auth/google/start/route";
import { GET as CALLBACK } from "@/app/api/auth/google/callback/route";

const fake = redis as unknown as { _reset: () => void };

const CLIENT_ID = "client-123.apps.googleusercontent.com";
const FLOW = { state: "state-abc", nonce: "nonce-abc", verifier: "verifier-abc" };

const get = (path: string) => new NextRequest(`http://localhost:3000${path}`);
const callback = (query = `code=auth-code&state=${FLOW.state}`) =>
  CALLBACK(get(`/api/auth/google/callback?${query}`));

/** The browser came back from Google having started on sign-up (a role) or sign-in (none). */
function startedFlow(role: "PAYER" | "MERCHANT" | null) {
  cookieJar.set(OAUTH_COOKIE, JSON.stringify({ ...FLOW, role }));
}

function idToken(claims: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

/** Google's token endpoint answers with an ID token carrying these claims. */
function googleAnswers(overrides: Record<string, unknown> = {}) {
  const claims = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: "google-sub-1",
    nonce: FLOW.nonce,
    email: "Ana@Example.com",
    email_verified: true,
    ...overrides,
  };
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({ id_token: idToken(claims) }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Google sign-in", () => {
  beforeEach(async () => {
    cookieJar.clear();
    fake._reset();
    await resetDb();
    vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("start", () => {
    it("sends the browser to Google and remembers the flow and the chosen role", async () => {
      const res = await START(get("/api/auth/google/start?role=MERCHANT"));
      expect(res.status).toBe(303);
      const url = new URL(res.headers.get("location")!);
      expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
      expect(url.searchParams.get("redirect_uri")).toBe(
        "http://localhost:3000/api/auth/google/callback",
      );
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");

      const flow = JSON.parse(cookieJar.get(OAUTH_COOKIE)!.value);
      expect(flow.role).toBe("MERCHANT");
      expect(url.searchParams.get("state")).toBe(flow.state);
      expect(url.searchParams.get("nonce")).toBe(flow.nonce);
    });

    it("carries no role for a sign-in, and ignores a role nobody can pick", async () => {
      await START(get("/api/auth/google/start?role=ADMIN"));
      expect(JSON.parse(cookieJar.get(OAUTH_COOKIE)!.value).role).toBeNull();
    });

    it("goes back with a message when Google sign-in is not set up", async () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "");
      const res = await START(get("/api/auth/google/start"));
      expect(res.headers.get("location")).toBe("/login?error=google_unavailable");
    });
  });

  describe("callback", () => {
    it("creates a PAYER with a verified email, a wallet and no password", async () => {
      startedFlow("PAYER");
      const fetchMock = googleAnswers();
      const res = await callback();
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/payer/dashboard");

      const user = await db.user.findUniqueOrThrow({ where: { email: "ana@example.com" } });
      expect(user).toMatchObject({ role: "PAYER", googleSub: "google-sub-1", passwordHash: null });
      expect(user.emailVerifiedAt).toBeInstanceOf(Date);
      expect(await db.custodialWallet.count({ where: { userId: user.id } })).toBe(1);
      expect(cookieJar.get(SESSION_COOKIE)?.value).toBeTruthy();

      // The code was exchanged with the PKCE verifier from the cookie.
      const body = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("code_verifier")).toBe(FLOW.verifier);
    });

    it("names the account after its email, with a suffix when that name is taken", async () => {
      await db.user.create({ data: { username: "ana", passwordHash: "x", role: "MERCHANT" } });
      startedFlow("MERCHANT");
      googleAnswers();
      await callback();
      const user = await db.user.findUniqueOrThrow({ where: { email: "ana@example.com" } });
      expect(user.username).toMatch(/^ana_[0-9a-f]{4}$/);
    });

    it("signs a returning Google account in without making a second one", async () => {
      startedFlow("PAYER");
      googleAnswers();
      await callback();
      cookieJar.clear();

      startedFlow(null);
      googleAnswers();
      const res = await callback();
      expect(res.headers.get("location")).toBe("/payer/dashboard");
      expect(await db.user.count()).toBe(1);
      expect(cookieJar.get(SESSION_COOKIE)?.value).toBeTruthy();
    });

    it("links Google to the account that signed up with the same email", async () => {
      const existing = await db.user.create({
        data: {
          username: "ana",
          email: "ana@example.com",
          emailVerifiedAt: new Date(),
          passwordHash: "x",
          role: "MERCHANT",
        },
      });
      startedFlow(null);
      googleAnswers();
      const res = await callback();
      expect(res.headers.get("location")).toBe("/merchant/dashboard");
      const user = await db.user.findUniqueOrThrow({ where: { id: existing.id } });
      expect(user.googleSub).toBe("google-sub-1");
      expect(user.passwordHash).toBe("x"); // the password still works
      expect(await db.user.count()).toBe(1);
    });

    it("sends a sign-in with no HeyPay account to sign-up to choose a role", async () => {
      startedFlow(null);
      googleAnswers();
      const res = await callback();
      expect(res.headers.get("location")).toBe("/signup?error=google_no_account");
      expect(await db.user.count()).toBe(0);
      expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();
    });

    it("refuses a callback whose state is not the one this browser started with", async () => {
      startedFlow("PAYER");
      const fetchMock = googleAnswers();
      const res = await callback("code=auth-code&state=someone-elses");
      expect(res.headers.get("location")).toBe("/signup?error=google_failed");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await db.user.count()).toBe(0);
    });

    it("refuses a callback with no flow cookie", async () => {
      googleAnswers();
      const res = await callback();
      expect(res.headers.get("location")).toBe("/login?error=google_failed");
    });

    it.each([
      ["another client's token", { aud: "someone-else.apps.googleusercontent.com" }],
      ["another issuer's token", { iss: "https://evil.example" }],
      ["an expired token", { exp: Math.floor(Date.now() / 1000) - 10 }],
      ["a token for another sign-in attempt", { nonce: "other-nonce" }],
    ])("refuses %s", async (_name, claims) => {
      startedFlow("PAYER");
      googleAnswers(claims);
      const res = await callback();
      expect(res.headers.get("location")).toBe("/signup?error=google_failed");
      expect(await db.user.count()).toBe(0);
    });

    it("refuses a Google account whose email Google has not verified", async () => {
      startedFlow("PAYER");
      googleAnswers({ email_verified: false });
      const res = await callback();
      expect(res.headers.get("location")).toBe("/signup?error=google_unverified");
      expect(await db.user.count()).toBe(0);
    });

    it("does not sign in an account that has been turned off", async () => {
      await db.user.create({
        data: { username: "ana", googleSub: "google-sub-1", role: "PAYER", isActive: false },
      });
      startedFlow(null);
      googleAnswers();
      const res = await callback();
      expect(res.headers.get("location")).toBe("/login?error=account_inactive");
      expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();
    });

    it("reports a sign-in the person cancelled at Google", async () => {
      startedFlow(null);
      const res = await callback("error=access_denied&state=state-abc");
      expect(res.headers.get("location")).toBe("/login?error=google_cancelled");
    });

    it("uses the flow once", async () => {
      startedFlow("PAYER");
      googleAnswers();
      await callback();
      expect(cookieJar.get(OAUTH_COOKIE)?.value).toBe("");
    });
  });
});
