import { execSync } from "node:child_process";
import { E2E_PDAX_XLM_DEPOSIT_ADDRESS } from "./fixtures";

// Truncate every public table except Prisma's migration ledger, in one statement.
// Run through `prisma db execute` (no client import — Playwright's ESM loader can't
// resolve the generated client's directory export).
const TRUNCATE_ALL_SQL = `
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
  END LOOP;
END $$;`;

const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql://heypay:heypay@localhost:5433/heypay_e2e?schema=public";

export default async function globalSetup(): Promise<void> {
  const env = {
    ...process.env,
    DATABASE_URL: E2E_DATABASE_URL,
    SHADOW_DATABASE_URL: E2E_DATABASE_URL.replace("heypay_e2e", "heypay_e2e_shadow"),
    SEED_DEMO: "false", // tests create their own deterministic fixtures
    ADMIN_USERNAME: process.env.ADMIN_USERNAME ?? "admin",
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "admin-e2e-pass",
    // The prod build enforces the admin force-password-change gate; pre-satisfy it so
    // the admin console is reachable in e2e without walking the change-password flow.
    SEED_ADMIN_PWCHANGE_DONE: "true",
  };
  execSync("pnpm prisma migrate deploy", { stdio: "inherit", env });

  // Truncate every app table before seeding so a reused throwaway volume can't leak rows
  // between runs. A registered QRPH is globally unique, so a merchant left over from a
  // prior run would block the go-live spec (which types the fixed DEMO_QRPH_RAW) at the
  // "already registered" step. Truncate (vs `migrate reset`) needs no exclusive DB access,
  // so it works even while a reused webServer holds connections. Guarded by the dedicated
  // e2e DATABASE_URL.
  execSync("pnpm prisma db execute --stdin", {
    input: TRUNCATE_ALL_SQL,
    stdio: ["pipe", "inherit", "inherit"],
    env,
  });

  execSync("pnpm prisma db seed", { stdio: "inherit", env }); // seeds the admin

  // Ensure the mock-rail Stellar deposit sink exists on testnet (idempotent: 200 first
  // time, 400 "already funded" thereafter — both fine). Without it, the settlement's
  // real custodial→deposit XLM payment fails and every payment ends FAILED.
  const res = await fetch(
    `https://friendbot.stellar.org/?addr=${encodeURIComponent(E2E_PDAX_XLM_DEPOSIT_ADDRESS)}`,
  );
  if (![200, 400].includes(res.status)) {
    throw new Error(`friendbot funding of PDAX deposit sink failed: ${res.status}`);
  }
}
