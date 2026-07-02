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

async function main(): Promise<void> {
  await seedAdmin();
  await seedDemo();
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
