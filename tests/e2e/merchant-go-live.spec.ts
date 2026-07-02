import { test, expect } from "@playwright/test";
import {
  DEMO_QRPH_RAW,
  DEMO_QRPH_MERCHANT_NAME,
  uniqueUser,
  signup,
  login,
  fundWithFriendbot,
  newApiContext,
} from "./fixtures";

test("merchant completes onboarding, goes live, and sees a settlement", async ({
  page,
  baseURL,
}) => {
  test.slow();

  // --- Merchant signs up + onboards via the wizard UI ---
  const merchant = uniqueUser("merch");
  const merchantCtx = await newApiContext(baseURL);
  await signup(merchantCtx, merchant, "MERCHANT");
  await login(page, merchant);

  await page.goto("/merchant/onboarding");

  // Step 1 — Business identity
  await page.getByLabel(/business name/i).fill(DEMO_QRPH_MERCHANT_NAME);
  await page.getByRole("button", { name: /next|continue/i }).click();

  // Step 2 — Settlement account
  await page.getByRole("radio", { name: /BPI/i }).click();
  await page.getByLabel(/account name/i).fill("HeyPay Demo Inc");
  await page.getByLabel(/account number/i).fill("1234567890");
  await page.getByRole("button", { name: /next|continue/i }).click();

  // Step 3 — Link QRPH (paste raw). Target the paste field precisely to avoid
  // matching the file-upload input that also mentions "QRPH".
  await page.getByLabel(/paste raw qrph/i).fill(DEMO_QRPH_RAW);
  await page.getByRole("button", { name: /next|continue/i }).click();
  await expect(page.getByText(DEMO_QRPH_MERCHANT_NAME)).toBeVisible();

  // Step 4 — Review → Go Live
  await page.getByRole("button", { name: /go live/i }).click();

  // Dashboard reflects ACTIVE status
  await page.waitForURL(/\/merchant\/dashboard/);
  await expect(page.getByText(/active|live/i)).toBeVisible();

  // Confirm ACTIVE via API
  const me = await merchantCtx.get("/api/merchant/me");
  expect(me.ok(), await me.text()).toBeTruthy();
  const { merchant: merchantRecord } = await me.json();
  expect(merchantRecord.status).toBe("ACTIVE");
  const merchantId: string = merchantRecord.id;

  // --- A payer settles a payment to this merchant (API for speed) ---
  const payer = uniqueUser("payer");
  const payerCtx = await newApiContext(baseURL);
  await signup(payerCtx, payer, "PAYER");
  const addr = await payerCtx.get("/api/wallet/deposit-address");
  const { publicKey } = await addr.json();
  await fundWithFriendbot(payerCtx, publicKey);
  await expect
    .poll(
      async () => {
        const s = await payerCtx.post("/api/wallet/sync", { data: {} });
        return s.ok() ? Number((await s.json()).balanceXlm) : 0;
      },
      { timeout: 60_000, intervals: [2000] },
    )
    .toBeGreaterThan(100);

  const quoteRes = await payerCtx.post("/api/payments/quote", {
    data: { merchantId, amountPhp: "175.00" },
  });
  expect(quoteRes.ok(), await quoteRes.text()).toBeTruthy();
  const { paymentId } = await quoteRes.json();
  const confirmRes = await payerCtx.post(`/api/payments/${paymentId}/confirm`, {
    data: {},
    headers: { "Idempotency-Key": `e2e-${paymentId}` },
  });
  expect(confirmRes.ok(), await confirmRes.text()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const r = await payerCtx.get(`/api/payments/${paymentId}`);
        return r.ok() ? (await r.json()).payment.status : "ERR";
      },
      { timeout: 90_000, intervals: [2000] },
    )
    .toBe("SETTLED");

  // --- Settlement appears in the merchant's business transactions ---
  await page.goto("/merchant/transactions");
  await expect(page.getByText(/₱\s*175(\.00)?/).first()).toBeVisible({ timeout: 30_000 });
  // Scope to the table so we match the row's status badge, not the filter's <option>SETTLED.
  await expect(
    page
      .locator("table")
      .getByText(/settled/i)
      .first(),
  ).toBeVisible();

  await merchantCtx.dispose();
  await payerCtx.dispose();
});
