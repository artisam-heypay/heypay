import { test, expect } from "@playwright/test";
import { uniqueUser, signup, login, ensureActiveMerchant, newApiContext } from "./fixtures";

test("qr page renders the code, a copyable payment link and print files", async ({
  page,
  baseURL,
}) => {
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
  await expect(page.getByRole("link", { name: /Download PDF/i })).toBeVisible();

  // Both files download, named after the shop.
  for (const format of ["PDF", "PNG"]) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: new RegExp(`Download ${format}`, "i") }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`-qr\\.${format.toLowerCase()}$`));
  }
});
