import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  signup,
  login,
  fundWithFriendbot,
  ensureActiveMerchant,
  newApiContext,
} from "./fixtures";

// MockProvider forced-failure trigger amount (Phase 4). Reconcile with the actual mock rail convention.
const FORCE_FAIL_PHP = "66.66";
const ADMIN = {
  username: process.env.ADMIN_USERNAME ?? "admin",
  password: process.env.ADMIN_PASSWORD ?? "admin-e2e-pass",
};

test("admin views a failed payment and refunds it", async ({ page, baseURL }) => {
  test.slow();

  // --- Setup: merchant + funded payer; create a payment that the mock rail will FAIL ---
  const merchantCtx = await newApiContext(baseURL);
  const merchant = uniqueUser("merch");
  await signup(merchantCtx, merchant, "MERCHANT");
  const { merchantId } = await ensureActiveMerchant(merchantCtx);
  await merchantCtx.dispose();

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
    data: { merchantId, amountPhp: FORCE_FAIL_PHP },
  });
  expect(quoteRes.ok(), await quoteRes.text()).toBeTruthy();
  const { paymentId } = await quoteRes.json();
  const confirmRes = await payerCtx.post(`/api/payments/${paymentId}/confirm`, {
    data: {},
    headers: { "Idempotency-Key": `e2e-fail-${paymentId}` },
  });
  expect(confirmRes.ok(), await confirmRes.text()).toBeTruthy();

  // --- Wait until the payment enters the failure/refund family ---
  // The forced payout failure happens after XLM left the wallet, so the worker
  // auto-routes it REFUND_PENDING → REFUNDED per SPEC §8.2 (the refund branch).
  await expect
    .poll(
      async () => {
        const r = await payerCtx.get(`/api/payments/${paymentId}`);
        return r.ok() ? (await r.json()).payment.status : "ERR";
      },
      { timeout: 90_000, intervals: [2000] },
    )
    .toMatch(/FAILED|REFUND_PENDING|REFUNDED/);

  // --- Admin logs in and finds the payment ---
  await login(page, ADMIN);
  await page.goto("/admin/payments");
  const row = page.locator(`tr[data-payment-id="${paymentId}"]`).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  // Badge renders the status with underscores replaced by spaces.
  await expect(row.getByText(/FAILED|REFUND[_ ]?PENDING|REFUNDED/)).toBeVisible();

  // --- Admin triggers the refund through the console UI (real admin session + CSRF).
  // A post-XLM failure also auto-refunds (SPEC §8.2), so the click may race the worker;
  // either way the payment must reach REFUNDED. ---
  await row.getByRole("button", { name: /refund payment/i }).click();
  await page.getByRole("button", { name: /confirm refund/i }).click();

  // --- Observe the payment reach REFUNDED (poll via the payer's own session) ---
  await expect
    .poll(
      async () => {
        const r = await payerCtx.get(`/api/payments/${paymentId}`);
        return r.ok() ? (await r.json()).payment.status : "ERR";
      },
      { timeout: 90_000, intervals: [2000] },
    )
    .toBe("REFUNDED");

  // --- The admin payments view reflects the refund (fresh server render). Re-establish
  // the admin session if it lapsed during the refund interlude. ---
  await page.goto("/admin/payments");
  if (page.url().includes("/login")) {
    await login(page, ADMIN);
    await page.goto("/admin/payments");
  }
  await expect(page.locator(`tr[data-payment-id="${paymentId}"]`).first()).toContainText(
    /REFUNDED/,
    { timeout: 15_000 },
  );

  await payerCtx.dispose();
});
