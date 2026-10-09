import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { walletService } from "@/server/stellar/wallet";
import type { Prisma, User } from "@/generated/prisma/client";

/** The roles a person can pick for themselves. ADMIN is only ever seeded. */
export type SignupRole = "PAYER" | "MERCHANT";

/** Emails are stored and compared in lowercase. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * The account a sign-in form means. A username cannot contain "@", so anything
 * with one is looked up as an email first.
 */
export async function findUserByLogin(identifier: string): Promise<User | null> {
  if (identifier.includes("@")) {
    const byEmail = await db.user.findUnique({ where: { email: normalizeEmail(identifier) } });
    if (byEmail) return byEmail;
  }
  return db.user.findUnique({ where: { username: identifier } });
}

/**
 * A Google sign-up never asks for a username, but every account has one (it is
 * what the app shows). This takes the part before the "@" and adds a short
 * suffix when that name is taken.
 */
async function usernameFor(tx: Prisma.TransactionClient, email: string): Promise<string> {
  const base = (email.split("@")[0] ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, "_")
    .slice(0, 20)
    .padEnd(3, "_");
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}_${randomBytes(2).toString("hex")}`;
    const taken = await tx.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `${base}_${randomBytes(5).toString("hex")}`;
}

/**
 * Creates an account whose email is already confirmed, with a custodial wallet
 * for a payer. Run inside a transaction so the user and wallet appear together.
 */
export async function createVerifiedAccount(
  tx: Prisma.TransactionClient,
  input: {
    email: string;
    role: SignupRole;
    /** The one chosen on the sign-up form. Left out, one is made from the email. */
    username?: string;
    passwordHash?: string;
    googleSub?: string;
  },
): Promise<User> {
  const user = await tx.user.create({
    data: {
      username: input.username ?? (await usernameFor(tx, input.email)),
      email: input.email,
      emailVerifiedAt: new Date(),
      passwordHash: input.passwordHash ?? null,
      googleSub: input.googleSub ?? null,
      role: input.role,
    },
  });
  await createWalletFor(tx, user);
  return user;
}

/** A payer's custodial wallet. Other roles have none. */
export async function createWalletFor(tx: Prisma.TransactionClient, user: User): Promise<void> {
  if (user.role !== "PAYER") return;
  const wallet = walletService.generate();
  await tx.custodialWallet.create({
    data: {
      userId: user.id,
      stellarPublicKey: wallet.publicKey,
      encryptedSecret: wallet.encryptedSecret,
      secretKeyVersion: wallet.secretKeyVersion,
    },
  });
}
