"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/server/db";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "@/server/auth/password";
import { createSession, destroySession } from "@/server/auth/sessions";
import { rateLimit } from "@/server/auth/rate-limit";
import { audit } from "@/server/auth/audit";
import { walletService } from "@/server/stellar/wallet";
import { dashboardPath } from "@/lib/auth-redirect";

export type AuthState = { error?: string };

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

const signupSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.]+$/, "Letters, numbers, dot or underscore only"),
  password: z.string().min(8, "At least 8 characters").max(200),
  role: z.enum(["PAYER", "MERCHANT"]),
});

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
  if (!parsed.success) return { error: "Enter your username and password." };

  const { ip, userAgent } = await requestMeta();
  try {
    await rateLimit(`login:ip:${ip}`, { limit: 20, windowSec: 900 });
  } catch {
    return { error: "Too many attempts. Please wait a moment and try again." };
  }

  const user = await db.user.findUnique({ where: { username: parsed.data.username } });
  const ok =
    !!user && user.isActive && (await verifyPassword(user.passwordHash, parsed.data.password));
  if (!user) await verifyPassword(DUMMY_PASSWORD_HASH, parsed.data.password); // timing equalization

  if (!ok) {
    await audit({
      actorId: user?.id ?? null,
      action: "auth.login.failed",
      target: parsed.data.username,
      ip,
    });
    return { error: "Invalid username or password." };
  }

  await createSession(user.id, { ip, userAgent });
  await audit({ actorId: user.id, action: "auth.login", target: user.id, ip });
  redirect(dashboardPath(user.role)); // throws NEXT_REDIRECT — must be outside try/catch
}

export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Check your details and try again." };

  const { ip, userAgent } = await requestMeta();
  try {
    await rateLimit(`signup:ip:${ip}`, { limit: 5, windowSec: 3600 });
  } catch {
    return { error: "Too many sign-up attempts. Please try again later." };
  }

  const exists = await db.user.findUnique({ where: { username: parsed.data.username } });
  if (exists) return { error: "Username is not available." };

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { username: parsed.data.username, passwordHash, role: parsed.data.role },
    });
    if (parsed.data.role === "PAYER") {
      const wallet = walletService.generate(); // Phase 3 contract; mocked in CI until built
      await tx.custodialWallet.create({
        data: {
          userId: created.id,
          stellarPublicKey: wallet.publicKey,
          encryptedSecret: wallet.encryptedSecret,
          secretKeyVersion: wallet.secretKeyVersion,
        },
      });
    }
    return created;
  });

  await createSession(user.id, { ip, userAgent });
  await audit({ actorId: user.id, action: "auth.signup", target: user.id, ip });
  redirect(dashboardPath(user.role));
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
