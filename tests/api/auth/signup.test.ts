import { describe, it, expect, beforeEach, vi } from "vitest";
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
vi.mock("@/server/email/send", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { redis } from "@/server/redis";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/send";
import { verifyPassword } from "@/server/auth/password";
import { SESSION_COOKIE } from "@/server/auth/sessions";
import { SIGNUP_COOKIE } from "@/server/auth/signup";
import { POST as START } from "@/app/api/auth/signup/route";
import { POST as VERIFY } from "@/app/api/auth/signup/verify/route";
import { POST as RESEND } from "@/app/api/auth/signup/resend/route";

const fake = redis as unknown as { _reset: () => void };
const sent = vi.mocked(sendEmail);

const ctx = { params: Promise.resolve({}) };
const mk = (path: string, body: unknown) =>
  new NextRequest(`http://localhost:3000/api/auth/signup${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });

const start = (body: unknown) => START(mk("", body), ctx);
const verify = (code: string) => VERIFY(mk("/verify", { code }), ctx);
const resend = () => RESEND(mk("/resend", {}), ctx);

/** The code in the most recent email. */
function lastCode(): string {
  const email = sent.mock.calls.at(-1)?.[0];
  const code = email?.text.match(/\b\d{6}\b/)?.[0];
  if (!code) throw new Error("no code was emailed");
  return code;
}

/** A 6-digit code that is not `code`. */
const wrong = (code: string) => (code === "000000" ? "000001" : "000000");

const PAYER = {
  email: "Ana@Example.com",
  username: "Ana_Reyes",
  password: "supersecret1",
  role: "PAYER",
};

describe("email sign-up", () => {
  beforeEach(async () => {
    cookieJar.clear();
    fake._reset();
    sent.mockReset();
    sent.mockResolvedValue(undefined);
    await resetDb();
  });

  it("emails a code and creates no account until it is confirmed", async () => {
    const res = await start(PAYER);
    expect(res.status).toBe(202);
    expect(await db.user.count()).toBe(0);
    expect(await db.pendingSignup.count()).toBe(1);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]?.[0].to).toBe("ana@example.com");
    expect(cookieJar.get(SIGNUP_COOKIE)?.value).toBeTruthy();
    expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("creates a PAYER with a verified email and a wallet once the code is entered", async () => {
    await start(PAYER);
    const res = await verify(lastCode());
    expect(res.status).toBe(201);
    // The username is the one typed, not one made from the email.
    expect((await res.json()).user).toMatchObject({ username: "Ana_Reyes", role: "PAYER" });

    const user = await db.user.findUniqueOrThrow({ where: { email: "ana@example.com" } });
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await verifyPassword(user.passwordHash ?? "", "supersecret1")).toBe(true);
    const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
    expect(wallet?.stellarPublicKey).toBe("GTEST");
    expect(cookieJar.get(SESSION_COOKIE)?.value).toBeTruthy();
    expect(await db.pendingSignup.count()).toBe(0);
  });

  it("creates a MERCHANT with no wallet", async () => {
    await start({ ...PAYER, role: "MERCHANT" });
    expect((await verify(lastCode())).status).toBe(201);
    expect(await db.custodialWallet.count()).toBe(0);
  });

  it("refuses a username that already has an account, before any email is sent", async () => {
    await db.user.create({ data: { username: "Ana_Reyes", passwordHash: "x", role: "MERCHANT" } });
    const res = await start(PAYER);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/username is taken/);
    expect(sent).not.toHaveBeenCalled();
    expect(await db.pendingSignup.count()).toBe(0);
  });

  it("refuses the code when the username was taken while it was on its way", async () => {
    await start(PAYER);
    await db.user.create({ data: { username: "Ana_Reyes", passwordHash: "x", role: "MERCHANT" } });
    const res = await verify(lastCode());
    expect(res.status).toBe(409);
    expect(await db.user.count({ where: { email: "ana@example.com" } })).toBe(0);
    expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("refuses a wrong code and creates nothing", async () => {
    await start(PAYER);
    const res = await verify(wrong(lastCode()));
    expect(res.status).toBe(400);
    expect(await db.user.count()).toBe(0);
  });

  it("stops accepting codes after five wrong tries, even the right one", async () => {
    await start(PAYER);
    const code = lastCode();
    for (let i = 0; i < 5; i++) expect((await verify(wrong(code))).status).toBe(400);
    expect((await verify(code)).status).toBe(429);
    expect(await db.user.count()).toBe(0);
  });

  it("refuses an expired code", async () => {
    await start(PAYER);
    await db.pendingSignup.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await verify(lastCode())).status).toBe(400);
    expect(await db.user.count()).toBe(0);
  });

  it("uses a code once", async () => {
    await start(PAYER);
    const code = lastCode();
    expect((await verify(code)).status).toBe(201);
    expect((await verify(code)).status).toBe(400);
    expect(await db.user.count()).toBe(1);
  });

  it("refuses a code without the browser that started the sign-up", async () => {
    await start(PAYER);
    const code = lastCode();
    cookieJar.clear();
    expect((await verify(code)).status).toBe(400);
    expect(await db.user.count()).toBe(0);
  });

  it("does not let a code sent for someone else's attempt confirm this one", async () => {
    // The owner of the inbox starts a sign-up...
    await start(PAYER);
    const owner = cookieJar.get(SIGNUP_COOKIE)!.value;
    // ...then a stranger starts one for the same address with their own password.
    cookieJar.clear();
    await start({ ...PAYER, password: "strangers-password" });
    const strangersCode = lastCode();

    // The owner types the newest code from their inbox. It must not create an
    // account, least of all one with the stranger's password.
    cookieJar.clear();
    cookieJar.set(SIGNUP_COOKIE, owner);
    expect((await verify(strangersCode)).status).toBe(400);
    expect(await db.user.count()).toBe(0);
  });

  it("refuses an email that already has an account", async () => {
    await start(PAYER);
    await verify(lastCode());
    cookieJar.clear();
    sent.mockClear();
    const res = await start({ ...PAYER, email: "ANA@example.com" });
    expect(res.status).toBe(409);
    expect(sent).not.toHaveBeenCalled();
  });

  it("makes a new code wait a minute, then replaces the old one", async () => {
    await start(PAYER);
    const first = lastCode();
    expect((await resend()).status).toBe(429);

    await db.pendingSignup.updateMany({ data: { lastSentAt: new Date(Date.now() - 61_000) } });
    expect((await resend()).status).toBe(204);
    const second = lastCode();
    expect(sent).toHaveBeenCalledTimes(2);
    if (second !== first) expect((await verify(first)).status).toBe(400);
    expect((await verify(second)).status).toBe(201);
  });

  it("forgets the sign-up when the email cannot be sent", async () => {
    const { emailNotSent } =
      await vi.importActual<typeof import("@/server/email/send")>("@/server/email/send");
    sent.mockRejectedValueOnce(emailNotSent());
    const res = await start(PAYER);
    expect(res.status).toBe(502);
    expect(await db.pendingSignup.count()).toBe(0);
    expect(cookieJar.get(SIGNUP_COOKIE)).toBeUndefined();
  });

  it("rejects an invalid role, a short password and a bad email with 400", async () => {
    expect((await start({ ...PAYER, role: "ADMIN" })).status).toBe(400);
    expect((await start({ ...PAYER, password: "123" })).status).toBe(400);
    expect((await start({ ...PAYER, email: "not-an-email" })).status).toBe(400);
    expect(sent).not.toHaveBeenCalled();
  });

  it("rejects a missing, short or oddly spelled username with 400", async () => {
    const { username: _none, ...noUsername } = PAYER;
    expect((await start(noUsername)).status).toBe(400);
    expect((await start({ ...PAYER, username: "an" })).status).toBe(400);
    expect((await start({ ...PAYER, username: "ana reyes" })).status).toBe(400);
    // An email is not a username: the two are kept apart.
    expect((await start({ ...PAYER, username: "ana@example.com" })).status).toBe(400);
    expect(sent).not.toHaveBeenCalled();
  });
});
