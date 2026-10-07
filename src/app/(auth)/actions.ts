"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AppError } from "@/lib/errors";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/server/auth/password";
import { findUserByLogin } from "@/server/auth/accounts";
import { createSession, destroySession, getSessionUser } from "@/server/auth/sessions";
import { rateLimit } from "@/server/auth/rate-limit";
import { audit } from "@/server/auth/audit";
import {
  resendSignupCode,
  signupCodeSchema,
  signupSchema,
  startSignup,
  verifySignup,
} from "@/server/auth/signup";
import { captureUserEvent } from "@/server/observability/analytics";
import { dashboardPath } from "@/lib/auth-redirect";

export type AuthState = { error?: string; notice?: string };

// `username` also takes the account's email (see findUserByLogin).
const loginSchema = z.object({
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

// The sign-up service refuses with an AppError whose message is written for
// the person signing up. Anything else is a fault and goes to the error page.
function refusal(err: unknown): AuthState {
  if (err instanceof AppError) return { error: err.message };
  throw err;
}

async function requestMeta() {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
  return { ip, userAgent: h.get("user-agent") ?? undefined };
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter your email or username, and your password." };

  const { ip, userAgent } = await requestMeta();
  try {
    await rateLimit(`login:ip:${ip}`, { limit: 20, windowSec: 900 });
  } catch {
    return { error: "Too many attempts. Please wait a moment and try again." };
  }

  const user = await findUserByLogin(parsed.data.username);
  const ok =
    !!user?.passwordHash &&
    user.isActive &&
    (await verifyPassword(user.passwordHash, parsed.data.password));
  // Timing equalization: unknown users and Google-only accounts (no password) verify too.
  if (!user?.passwordHash) await verifyPassword(DUMMY_PASSWORD_HASH, parsed.data.password);

  if (!ok) {
    await audit({
      actorId: user?.id ?? null,
      action: "auth.login.failed",
      target: parsed.data.username,
      ip,
    });
    if (user) captureUserEvent("user_login_failed", user, { active: user.isActive });
    return { error: "Invalid email, username or password." };
  }

  await createSession(user.id, { ip, userAgent });
  await audit({ actorId: user.id, action: "auth.login", target: user.id, ip });
  captureUserEvent("user_logged_in", user);
  redirect(dashboardPath(user.role)); // throws NEXT_REDIRECT — must be outside try/catch
}

// Step one of email sign-up: emails a 6-digit code, then shows the page that asks for it.
export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Check your details and try again." };

  try {
    await startSignup(parsed.data, await requestMeta());
  } catch (err) {
    return refusal(err);
  }
  redirect("/signup/verify"); // throws NEXT_REDIRECT — must be outside try/catch
}

// Step two: the emailed code creates the account and signs it in.
export async function verifySignupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signupCodeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter the code." };

  let user;
  try {
    user = await verifySignup(parsed.data.code, await requestMeta());
  } catch (err) {
    return refusal(err);
  }
  redirect(dashboardPath(user.role));
}

export async function resendSignupCodeAction(): Promise<AuthState> {
  try {
    await resendSignupCode(await requestMeta());
  } catch (err) {
    return refusal(err);
  }
  return { notice: "We sent a new code. The earlier one no longer works." };
}

export async function logoutAction(): Promise<void> {
  const user = await getSessionUser();
  await destroySession();
  if (user) {
    const { ip } = await requestMeta();
    await audit({ actorId: user.id, action: "auth.logout", target: user.id, ip });
    captureUserEvent("user_logged_out", user);
  }
  redirect("/login");
}
