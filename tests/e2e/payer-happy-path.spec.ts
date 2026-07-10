import { test, expect } from "@playwright/test";
import {
  DEMO_QRPH_MERCHANT_NAME,
  uniqueUser,
  signup,
  login,
  fundWithFriendbot,
  ensureActiveMerchant,
  newApiContext,
} from "./fixtures";

test("payer pays a QRPH merchant from XLM balance through to SETTLED", async ({
  page,
  baseURL,
}) => {
  test.slow(); // settlement + friendbot funding take time

  // --- Setup: an ACTIVE merchant exists (own API session, isolated cookies) ---
  const merchantCtx = await newApiContext(baseURL);
  const merchant = uniqueUser("merch");
  await signup(merchantCtx, merchant, "MERCHANT");
  const { qrphRaw } = await ensureActiveMerchant(merchantCtx);
  await merchantCtx.dispose();

  // --- Payer signs up (gets a custodial wallet) ---
  const payer = uniqueUser("payer");
  const payerCtx = await newApiContext(baseURL);
  await signup(payerCtx, payer, "PAYER");

  // --- Prefund: friendbot-fund the custodial address, then sync ---
  const addrRes = await payerCtx.get("/api/wallet/deposit-address");
  expect(addrRes.ok(), await addrRes.text()).toBeTruthy();
  const { publicKey } = await addrRes.json();
  expect(publicKey).toMatch(/^G[A-Z2-7]{55}$/);
  await fundWithFriendbot(payerCtx, publicKey);

  await expect
    .poll(
      async () => {
        const sync = await payerCtx.post("/api/wallet/sync", { data: {} });
        if (!sync.ok()) return 0;
        const { balanceXlm } = await sync.json();
        return Number(balanceXlm);
      },
      { timeout: 60_000, intervals: [2000] },
    )
    .toBeGreaterThan(100); // friendbot funds 10000 XLM on testnet

  // --- Scan: feed the merchant's raw QRPH to the decode endpoint, expect merchant resolution ---
  const decodeRes = await payerCtx.post("/api/qrph/decode", { data: { raw: qrphRaw } });
  expect(decodeRes.ok(), await decodeRes.text()).toBeTruthy();
  const decoded = await decodeRes.json();
  expect(decoded.decoded.crcValid).toBe(true);
  expect(decoded.merchant, "QRPH should resolve to a registered merchant").toBeTruthy();
  const merchantId: string = decoded.merchant.id;

  // --- Quote: lock a rate for a PHP amount ---
  const quoteRes = await payerCtx.post("/api/payments/quote", {
    data: { merchantId, amountPhp: "250.00" },
  });
  expect(quoteRes.ok(), await quoteRes.text()).toBeTruthy();
  const quote = await quoteRes.json();
  expect(quote.paymentId).toBeTruthy();
  expect(Number(quote.amountAsset)).toBeGreaterThan(0);
  expect(quote.asset).toBe("XLM");
  const paymentId: string = quote.paymentId;

  // --- Confirm via the UI confirm screen (headline flow) ---
  await login(page, payer);
  await page.goto(`/payer/pay/${paymentId}/confirm`);
  await expect(page.getByText(DEMO_QRPH_MERCHANT_NAME)).toBeVisible();
  await expect(page.getByText(/₱\s*250(\.00)?/).first()).toBeVisible();
  await page.getByRole("button", { name: /confirm/i }).click();

  // Processing overlay appears
  await expect(page.getByText(/processing|sending|settl/i).first()).toBeVisible();

  // --- Poll the payment until SETTLED (worker + mock rail drive it) ---
  await expect
    .poll(
      async () => {
        const res = await payerCtx.get(`/api/payments/${paymentId}`);
        if (!res.ok()) return "ERR";
        const { payment } = await res.json();
        return payment.status as string;
      },
      { timeout: 90_000, intervals: [2000] },
    )
    .toBe("SETTLED");

  // --- Success screen ---
  await expect(page.getByText(/success|sent|settled|₱\s*250/i).first()).toBeVisible({
    timeout: 30_000,
  });

  await payerCtx.dispose();
});
