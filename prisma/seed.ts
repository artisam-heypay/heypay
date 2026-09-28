import "dotenv/config";
import * as argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Role, MerchantStatus } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// Minimal inline argon2id hash so the seed is self-contained (Phase 2 centralizes this).
async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

async function seedAdmin(): Promise<void> {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be set to seed the admin.");
  }
  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.upsert({
    where: { username },
    update: { role: Role.ADMIN, isActive: true },
    create: { username, passwordHash, role: Role.ADMIN },
  });
  console.log(`[seed] admin ready: ${admin.username}`);

  // For managed/e2e deploys where the admin is pre-provisioned, mark the force-change
  // gate satisfied by recording the password-change audit the gate looks for (idempotent).
  if (process.env.SEED_ADMIN_PWCHANGE_DONE === "true") {
    const already = await prisma.auditLog.findFirst({
      where: { actorId: admin.id, action: "auth.password.change" },
      select: { id: true },
    });
    if (!already) {
      await prisma.auditLog.create({
        data: { actorId: admin.id, action: "auth.password.change", target: admin.id },
      });
    }
    console.log("[seed] admin password-change gate marked satisfied");
  }
}

async function seedDemo(): Promise<void> {
  if (process.env.SEED_DEMO !== "true") {
    console.log("[seed] SEED_DEMO != 'true'; skipping demo data.");
    return;
  }

  // Demo payer. Custodial testnet wallet + friendbot funding is wired in Phase 3.
  const payerHash = await hashPassword("demo-payer-pass");
  const payer = await prisma.user.upsert({
    where: { username: "demo-payer" },
    update: {},
    create: { username: "demo-payer", passwordHash: payerHash, role: Role.PAYER },
  });
  console.log(
    `[seed] demo payer ready: ${payer.username} (custodial wallet stubbed until Phase 3)`,
  );

  // Demo merchant with a sample decoded QRPH + masked test bank account.
  // accountNumber is a placeholder; Phase 3 replaces it with an envelope-encrypted value.
  const merchantHash = await hashPassword("demo-merchant-pass");
  const merchantUser = await prisma.user.upsert({
    where: { username: "demo-merchant" },
    update: {},
    create: { username: "demo-merchant", passwordHash: merchantHash, role: Role.MERCHANT },
  });
  await prisma.merchant.upsert({
    where: { userId: merchantUser.id },
    update: {},
    create: {
      userId: merchantUser.id,
      businessName: "Demo Sari-Sari Store",
      status: MerchantStatus.ACTIVE,
      qrphRaw:
        "00020101021128120008ph.qrph0104DEMO5204000053036085802PH5914DEMO SARI-SARI6006MANILA6304ABCD",
      qrphMerchantName: "DEMO SARI-SARI",
      qrphMerchantCity: "MANILA",
      qrphMerchantId: "DEMO-MID-0001",
      qrphCountry: "PH",
      qrphCurrency: "608",
      settlementBankCode: "BPI",
      settlementBankName: "Bank of the Philippine Islands",
      accountName: "Demo Merchant Inc.",
      accountNumber: "stub:encrypt-in-phase3",
      accountNumberLast4: "6789",
    },
  });
  console.log(`[seed] demo merchant ready: ${merchantUser.username}`);
}

// Named UAT logins surfaced on the sign-in screen (see the login page's
// TEST_ACCOUNTS, since removed). Payer5 mirrors a real signup — PAYER user + custodial testnet
// wallet — so the app-wide invariant "every PAYER has a wallet" holds. merchant2
// is a fresh MERCHANT with no profile yet, so first login lands on onboarding,
// where the Security Bank settlement notice guides the whitelisted payout account.
async function seedTestAccounts(): Promise<void> {
  const testPassword = "12345678";

  const payerHash = await hashPassword(testPassword);
  const payer = await prisma.user.upsert({
    where: { username: "Payer5" },
    update: { role: Role.PAYER, isActive: true },
    create: { username: "Payer5", passwordHash: payerHash, role: Role.PAYER },
  });
  const existingWallet = await prisma.custodialWallet.findUnique({
    where: { userId: payer.id },
  });
  if (!existingWallet) {
    // Server-only crypto (envelope) — import lazily so a demo-only dependency
    // never blocks admin seeding, and only pay its cost when this block runs.
    const { walletService } = await import("../src/server/stellar/wallet");
    const wallet = walletService.generate();
    await prisma.custodialWallet.create({
      data: {
        userId: payer.id,
        stellarPublicKey: wallet.publicKey,
        encryptedSecret: wallet.encryptedSecret,
        secretKeyVersion: wallet.secretKeyVersion,
      },
    });
  }
  console.log(`[seed] test payer ready: ${payer.username}`);

  const merchantHash = await hashPassword(testPassword);
  const merchant = await prisma.user.upsert({
    where: { username: "merchant2" },
    update: { role: Role.MERCHANT, isActive: true },
    create: { username: "merchant2", passwordHash: merchantHash, role: Role.MERCHANT },
  });
  console.log(`[seed] test merchant ready: ${merchant.username} (onboarding pending)`);
}

async function main(): Promise<void> {
  // Each step is isolated: a failure in one (e.g. admin vars absent on a deploy)
  // must not stop the others. This runs as the release command's `db seed`, so it
  // must never fail a deploy — errors are logged, the process still exits 0.
  const steps: ReadonlyArray<[string, () => Promise<void>]> = [
    ["admin", seedAdmin],
    ["demo", seedDemo],
    ["test-accounts", seedTestAccounts],
  ];
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (err) {
      console.error(`[seed] ${name} failed (continuing):`, err);
    }
  }
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
