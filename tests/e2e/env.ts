// tests/e2e/env.ts
//
// Settings the Playwright config, globalSetup and the fixtures must agree on.
// The fixtures create accounts with a script that writes to the same database
// and encrypts wallet secrets with the same key as the web server under test.
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql://heypay:heypay@localhost:5433/heypay_e2e?schema=public";

export const ENCRYPTION_MASTER_KEY =
  process.env.ENCRYPTION_MASTER_KEY ?? "base64:MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";
