import { APIRequestContext, expect, Page, request as playwrightRequest } from "@playwright/test";

// Playwright's API request context is not a browser, so it sends no Origin /
// Sec-Fetch-Site header. The app's CSRF guard (assertSameOrigin) requires one on
// state-changing requests, so send an Origin matching the app's APP_URL.
const ORIGIN = process.env.APP_URL ?? `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const CSRF = { headers: { origin: ORIGIN } };

// Build an API request context whose every request carries the CSRF Origin header,
// so inline POSTs in specs (sync/quote/confirm) pass assertSameOrigin without each
// call having to remember to attach it. GETs ignore it; friendbot (absolute URL) is unaffected.
export async function newApiContext(baseURL: string | undefined): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { origin: ORIGIN } });
}

// Real EMVCo QRPH, CRC-16/CCITT-FALSE valid. Static (tag 01=11), PHP (53=608), merchant id HEYPAYDEMO0001.
export const DEMO_QRPH_RAW =
  "00020101021126330011ph.ppmi.p2m0114HEYPAYDEMO00015204581453036085802PH5920HEYPAY DEMO MERCHANT6006MANILA63042556";
export const DEMO_QRPH_MERCHANT_NAME = "HEYPAY DEMO MERCHANT";

// Dedicated testnet account that stands in for HeyPay's PDAX XLM deposit address.
// Even with PAYMENT_RAIL=mock the settlement's Stellar leg is real (SPEC §8.2), so the
// custodial→deposit payment needs a funded, existing destination. globalSetup friendbot-funds it.
export const E2E_PDAX_XLM_DEPOSIT_ADDRESS =
  "GBXGSQS3DVUWJVM4BA247MGKNCVRKNO72ONTILJK3DRI2IIPMSDGKACQ";

const CRC_POLY = 0x1021;
function crc16ccitt(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ CRC_POLY) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// A registered QRPH must be globally unique, so specs that each spin up their own
// merchant (rather than typing the fixed DEMO_QRPH_RAW through the UI) need a fresh,
// still-CRC-valid QRPH per call to avoid colliding with each other within one run.
function uniqueQrph(): string {
  const merchantId = `HP${Date.now().toString(36).toUpperCase()}${Math.floor(
    Math.random() * 36 ** 4,
  )
    .toString(36)
    .toUpperCase()}`
    .padEnd(14, "0")
    .slice(0, 14);
  const merchantBlock = `0011ph.ppmi.p2m0114${merchantId}`;
  const withoutCrc =
    "000201" +
    "010211" +
    "2633" +
    merchantBlock +
    "5204" +
    "5814" +
    "5303" +
    "608" +
    "5802" +
    "PH" +
    "5920" +
    "HEYPAY DEMO MERCHANT" +
    "6006" +
    "MANILA" +
    "6304";
  return withoutCrc + crc16ccitt(withoutCrc);
}

export function uniqueUser(prefix: string): { username: string; password: string } {
  return {
    username: `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
    password: "Sup3r-Secret-Pw!",
  };
}

export async function signup(
  request: APIRequestContext,
  user: { username: string; password: string },
  role: "PAYER" | "MERCHANT",
): Promise<void> {
  const res = await request.post("/api/auth/signup", { data: { ...user, role }, ...CSRF });
  expect(res.ok(), `signup failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

export async function login(
  page: Page,
  user: { username: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/username/i).fill(user.username);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/(payer|merchant|admin)/);
}

// Fund a testnet account via friendbot (idempotent enough for a fresh account).
export async function fundWithFriendbot(
  request: APIRequestContext,
  publicKey: string,
): Promise<void> {
  const res = await request.get(
    `https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`,
  );
  // 200 = funded now; 400 = already funded — both acceptable.
  expect([200, 400]).toContain(res.status());
}

// Create + onboard + go-live a merchant entirely via the API; returns its id and
// the (unique, per-call) QRPH raw string it was linked to.
export async function ensureActiveMerchant(
  request: APIRequestContext,
): Promise<{ merchantId: string; qrphRaw: string }> {
  const create = await request.post("/api/merchant", {
    data: { businessName: DEMO_QRPH_MERCHANT_NAME },
    ...CSRF,
  });
  expect(create.ok(), `merchant create failed: ${await create.text()}`).toBeTruthy();
  const { merchant } = await create.json();

  const settle = await request.post("/api/merchant/settlement", {
    data: { bankCode: "BPI", accountName: "HeyPay Demo Inc", accountNumber: "1234567890" },
    ...CSRF,
  });
  expect(settle.ok(), `settlement failed: ${await settle.text()}`).toBeTruthy();

  const qrphRaw = uniqueQrph();
  const qr = await request.post("/api/merchant/qrph", { data: { raw: qrphRaw }, ...CSRF });
  expect(qr.ok(), `qrph link failed: ${await qr.text()}`).toBeTruthy();

  const live = await request.post("/api/merchant/go-live", { data: {}, ...CSRF });
  expect(live.ok(), `go-live failed: ${await live.text()}`).toBeTruthy();

  return { merchantId: merchant.id, qrphRaw };
}
