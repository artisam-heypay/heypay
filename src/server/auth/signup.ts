// src/server/auth/signup.ts
//
// Email sign-up in two steps. Step one takes the email, password and role, and
// emails a 6-digit code. Step two takes the code and only then creates the
// account, so nobody owns an account for an address they cannot read.
//
// Between the steps the sign-up waits in PendingSignup, tied to the browser by
// a cookie. Confirming needs both the cookie and the code: whoever typed the
// password must also be able to read the inbox.
import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/server/db";
import { badRequest, conflict, tooManyRequests } from "@/lib/errors";
import type { User } from "@/generated/prisma/client";
import { sendEmail, type Email } from "@/server/email/send";
import { captureUserEvent } from "@/server/observability/analytics";
import { requestWalletActivation } from "@/server/wallet/activation";
import { createVerifiedAccount, type SignupRole } from "./accounts";
import { audit } from "./audit";
import { hashPassword } from "./password";
import { rateLimit } from "./rate-limit";
import { createSession } from "./sessions";

export const SIGNUP_COOKIE = "heypay_signup" as const;

const CODE_TTL_MIN = 10;
const CODE_TTL_MS = CODE_TTL_MIN * 60 * 1000;
const COOKIE_TTL_SEC = 30 * 60; // long enough to ask for a second code
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5; // wrong codes allowed per code sent
const CODES_PER_EMAIL_PER_HOUR = 5;
const STALE_AFTER_MS = 60 * 60 * 1000;

const SIGNUP_EXPIRED = "Your sign-up has expired. Please start again.";
const EMAIL_TAKEN = "An account with this email already exists. Sign in instead.";
const USERNAME_TAKEN = "That username is taken. Choose another one.";
const USERNAME_TAKEN_SINCE =
  "That username has just been taken. Start again and choose another one.";

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  // No "@", so a username can never be mistaken for an email at sign-in.
  username: z
    .string()
    .trim()
    .regex(
      /^[a-zA-Z0-9_.]{3,32}$/,
      "Choose a username of 3 to 32 letters, numbers, dots or underscores",
    ),
  password: z.string().min(8, "At least 8 characters").max(200),
  role: z.enum(["PAYER", "MERCHANT"]),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const signupCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export type RequestMeta = { ip: string; userAgent?: string };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Bound to the sign-up's own token, so one code never matches two sign-ups.
function hashCode(tokenHash: string, code: string): string {
  return sha256(`${tokenHash}:${code}`);
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

export function signupCodeEmail(to: string, code: string): Email {
  const ignore =
    "If you did not try to create a HeyPay account, you can ignore this email. No account is made without the code.";
  return {
    to,
    subject: `${code} is your HeyPay sign-up code`,
    text: [
      `Your HeyPay sign-up code is ${code}.`,
      `Enter it on the sign-up page to finish creating your account. The code works for ${CODE_TTL_MIN} minutes.`,
      ignore,
    ].join("\n\n"),
    html: [
      `<div style="font-family:Inter,Arial,sans-serif;color:#1d1b1a;max-width:480px">`,
      `<p>Your HeyPay sign-up code is:</p>`,
      `<p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#00bcd4;margin:16px 0">${code}</p>`,
      `<p>Enter it on the sign-up page to finish creating your account. The code works for ${CODE_TTL_MIN} minutes.</p>`,
      `<p style="color:#4e4643;font-size:14px">${ignore}</p>`,
      `</div>`,
    ].join(""),
  };
}

async function currentPending() {
  const token = (await cookies()).get(SIGNUP_COOKIE)?.value;
  if (!token) return null;
  return db.pendingSignup.findUnique({ where: { tokenHash: sha256(token) } });
}

/** The address this browser's sign-up is waiting on, for the "enter your code" page. */
export async function pendingSignupEmail(): Promise<string | null> {
  return (await currentPending())?.email ?? null;
}

/** Step one: remember the sign-up and email its code. */
export async function startSignup(input: SignupInput, meta: RequestMeta): Promise<void> {
  const signupLimit = Number(process.env.SIGNUP_RATE_LIMIT ?? "5");
  await rateLimit(`signup:ip:${meta.ip}`, { limit: signupLimit, windowSec: 3600 });

  const taken = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (taken) throw conflict(EMAIL_TAKEN);
  const nameTaken = await db.user.findUnique({
    where: { username: input.username },
    select: { id: true },
  });
  if (nameTaken) throw conflict(USERNAME_TAKEN);

  // Also caps how many emails a stranger can have sent to one address.
  await rateLimit(`signup:code:${input.email}`, {
    limit: CODES_PER_EMAIL_PER_HOUR,
    windowSec: 3600,
  });

  const passwordHash = await hashPassword(input.password);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const code = newCode();
  const now = Date.now();

  const store = await cookies();
  const previous = store.get(SIGNUP_COOKIE)?.value;
  // Drop this browser's earlier attempt, and attempts nobody finished: they
  // hold a password hash for an address that was never confirmed.
  await db.pendingSignup.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date(now - STALE_AFTER_MS) } },
        ...(previous ? [{ tokenHash: sha256(previous) }] : []),
      ],
    },
  });

  const pending = await db.pendingSignup.create({
    data: {
      tokenHash,
      email: input.email,
      username: input.username,
      passwordHash,
      role: input.role,
      codeHash: hashCode(tokenHash, code),
      expiresAt: new Date(now + CODE_TTL_MS),
    },
  });
  try {
    await sendEmail(signupCodeEmail(input.email, code));
  } catch (err) {
    await db.pendingSignup.delete({ where: { id: pending.id } }).catch(() => undefined);
    throw err;
  }

  store.set(SIGNUP_COOKIE, token, { ...cookieOptions(), maxAge: COOKIE_TTL_SEC });
  await audit({ action: "auth.signup.code_sent", target: input.email, ip: meta.ip });
}

/** Sends a fresh code for this browser's sign-up. The earlier code stops working. */
export async function resendSignupCode(meta: RequestMeta): Promise<void> {
  const pending = await currentPending();
  if (!pending) throw badRequest(SIGNUP_EXPIRED);

  const waitMs = pending.lastSentAt.getTime() + RESEND_COOLDOWN_MS - Date.now();
  if (waitMs > 0) {
    throw tooManyRequests(
      `Please wait ${Math.ceil(waitMs / 1000)} seconds before asking for another code.`,
    );
  }
  await rateLimit(`signup:code:${pending.email}`, {
    limit: CODES_PER_EMAIL_PER_HOUR,
    windowSec: 3600,
  });

  const code = newCode();
  // Sent before it is stored: if the send fails, the code already in the inbox
  // keeps working.
  await sendEmail(signupCodeEmail(pending.email, code));
  await db.pendingSignup.update({
    where: { id: pending.id },
    data: {
      codeHash: hashCode(pending.tokenHash, code),
      attempts: 0,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      lastSentAt: new Date(),
    },
  });
  await audit({ action: "auth.signup.code_sent", target: pending.email, ip: meta.ip });
}

/** Step two: check the code, create the account and sign it in. */
export async function verifySignup(code: string, meta: RequestMeta): Promise<User> {
  await rateLimit(`signup:verify:ip:${meta.ip}`, { limit: 30, windowSec: 900 });

  const pending = await currentPending();
  if (!pending) throw badRequest(SIGNUP_EXPIRED);
  if (pending.expiresAt.getTime() < Date.now()) {
    throw badRequest("That code has expired. Ask for a new one.");
  }

  // Count the try before checking it, in one statement, so guesses sent in
  // parallel cannot get past the cap.
  const counted = await db.pendingSignup.updateMany({
    where: { id: pending.id, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) throw tooManyRequests("Too many wrong codes. Ask for a new one.");
  if (!sameHash(pending.codeHash, hashCode(pending.tokenHash, code))) {
    throw badRequest("That code is not right. Check the email and try again.");
  }

  const user = await db.$transaction(async (tx) => {
    // Deleting first makes the code single-use: a second request carrying the
    // same code finds nothing left to delete.
    const used = await tx.pendingSignup.deleteMany({
      where: { id: pending.id, codeHash: pending.codeHash },
    });
    if (used.count === 0) throw badRequest(SIGNUP_EXPIRED);

    // The address may have been taken since step one (by Google sign-in, say).
    const taken = await tx.user.findUnique({
      where: { email: pending.email },
      select: { id: true },
    });
    if (taken) throw conflict(EMAIL_TAKEN);
    // So may the username: nothing holds it while the code is on its way.
    const nameTaken = await tx.user.findUnique({
      where: { username: pending.username },
      select: { id: true },
    });
    if (nameTaken) throw conflict(USERNAME_TAKEN_SINCE);

    return createVerifiedAccount(tx, {
      email: pending.email,
      username: pending.username,
      role: pending.role as SignupRole,
      passwordHash: pending.passwordHash,
    });
  });
  await requestWalletActivation(user);

  // Attempts for the same address from other browsers are now dead ends.
  await db.pendingSignup.deleteMany({ where: { email: pending.email } });
  (await cookies()).delete(SIGNUP_COOKIE);

  await createSession(user.id, meta);
  await audit({
    actorId: user.id,
    action: "auth.signup",
    target: user.id,
    metadata: { method: "email" },
    ip: meta.ip,
  });
  captureUserEvent("user_signed_up", user, { method: "email" });
  return user;
}
