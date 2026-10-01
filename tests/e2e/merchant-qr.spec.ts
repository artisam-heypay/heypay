import { test, expect } from "@playwright/test";
import { uniqueUser, signup, login, ensureActiveMerchant, newApiContext } from "./fixtures";

test("qr page renders the code and a copyable payment link", async ({ page, baseURL }) => {
  const merchantCtx = await newApiContext(baseURL);
  const merchant = uniqueUser("merch");
  await signup(merchantCtx, merchant, "MERCHANT");
  await ensureActiveMerchant(merchantCtx);
  await merchantCtx.dispose();

  await login(page, merchant);
  await page.goto("/merchant/qr");

  await expect(page.getByText("My Business QR")).toBeVisible();
  await expect(page.locator("svg").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy link/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Download/i })).toBeVisible();
});
