#!/usr/bin/env tsx
/**
 * Creates one login with a username and password and no email, straight in the
 * database. Signing up on the site needs a code from an email inbox; this is
 * for the accounts that have none: ready-made tester logins and the e2e suite.
 *
 * Otherwise the account is what a sign-up makes: a PAYER gets a custodial
 * wallet, whose address is printed. Fails if the username is taken.
 *
 * The password comes from CREATE_USER_PASSWORD, not an argument, so it stays
 * out of the process list and the shell history.
 *
 * Usage (with the target environment's DATABASE_URL and ENCRYPTION_* set):
 *   CREATE_USER_PASSWORD=… pnpm user:create <username> <PAYER|MERCHANT>
 */
import "dotenv/config";
import { db } from "@/server/db";
import { createWalletFor } from "@/server/auth/accounts";
import { hashPassword } from "@/server/auth/password";

async function main(): Promise<void> {
  const [username, role] = process.argv.slice(2);
  const password = process.env.CREATE_USER_PASSWORD ?? "";
  if (
    !username ||
    !/^[a-zA-Z0-9_.]{3,32}$/.test(username) ||
    (role !== "PAYER" && role !== "MERCHANT") ||
    password.length < 8
  ) {
    throw new Error(
      "usage: CREATE_USER_PASSWORD=<8+ characters> create-user.ts <username: 3-32 letters, numbers, dot or underscore> <PAYER|MERCHANT>",
    );
  }
  if (await db.user.findUnique({ where: { username }, select: { id: true } })) {
    throw new Error(`username "${username}" is taken`);
  }

  const passwordHash = await hashPassword(password);
  const wallet = await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { username, passwordHash, role } });
    await createWalletFor(tx, user);
    return tx.custodialWallet.findUnique({ where: { userId: user.id } });
  });
  console.log(JSON.stringify({ username, role, wallet: wallet?.stellarPublicKey ?? null }));
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
