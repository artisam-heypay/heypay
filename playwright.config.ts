import { defineConfig, devices } from "@playwright/test";
import { e2eTreasury, encryptForApp } from "./tests/e2e/treasury";
import { E2E_DATABASE_URL, ENCRYPTION_MASTER_KEY } from "./tests/e2e/env";

const PORT = process.env.E2E_PORT ?? "3100";
const BASE_URL = `http://localhost:${PORT}`;
const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? "redis://localhost:6380";
const TREASURY = e2eTreasury();

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm e2e:serve",
    url: `${BASE_URL}/api/health`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "production",
      PORT,
      E2E_PORT: PORT,
      APP_URL: BASE_URL,
      PAYMENT_RAIL: "mock",
      // Real testnet Stellar leg needs a funded destination even under the mock rail;
      // globalSetup friendbot-funds this account so custodial→deposit payments land.
      HEYPAY_TREASURY_PUBLIC_KEY: TREASURY.publicKey(),
      // The refund path sends from the treasury, so it needs the secret.
      HEYPAY_TREASURY_SECRET_ENC: encryptForApp(TREASURY.secret(), ENCRYPTION_MASTER_KEY),
      // Magic PHP amount the admin-retry-refund spec uses to force a settlement failure.
      MOCK_FAIL_PHP_AMOUNT: "66.66",
      STELLAR_NETWORK: "testnet",
      STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
      STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
      DATABASE_URL: E2E_DATABASE_URL,
      SHADOW_DATABASE_URL: E2E_DATABASE_URL.replace("heypay_e2e", "heypay_e2e_shadow"),
      REDIS_URL: E2E_REDIS_URL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-session-secret-not-for-prod-0123456789",
      ENCRYPTION_MASTER_KEY,
      ENCRYPTION_KEY_VERSION: "1",
      ADMIN_USERNAME: process.env.ADMIN_USERNAME ?? "admin",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "admin-e2e-pass",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:9000",
      S3_PUBLIC_URL: process.env.S3_PUBLIC_URL ?? "http://localhost:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: process.env.S3_BUCKET ?? "heypay-uploads",
      S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "heypay",
      S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "heypay-secret",
      S3_FORCE_PATH_STYLE: "true",
    },
  },
});
