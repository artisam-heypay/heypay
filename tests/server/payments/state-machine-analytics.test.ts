import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../helpers/db";
import { db } from "@/server/db";
import { newPaymentReference } from "@/server/payments/reference";

const captureUserEvent = vi.fn();
vi.mock("@/server/observability/analytics", () => ({
  analyticsEnabled: () => true,
  captureUserEvent: (...args: unknown[]) => captureUserEvent(...args),
}));

const { applyTransition } = await import("@/server/payments/state-machine");

describe("applyTransition analytics", () => {
  beforeEach(async () => {
    await resetDb();
    captureUserEvent.mockReset();
  });

  async function makeAuthorized() {
    const { user: payer } = await makePayer();
    const { user: merchantUser, merchant } = await makeMerchant();
    const payment = await db.payment.create({
      data: {
        reference: newPaymentReference(),
        payerId: payer.id,
        merchantId: merchant.id,
        amountPhp: "150.00",
        quotedRate: "12.00000000",
        amountAsset: "12.5000000",
        networkFeeXlm: "0.0000100",
        status: "AUTHORIZED",
      },
    });
    return { payment, payer, merchantUser };
  }

  it("reports the step to both the payer and the merchant, with the failure reason", async () => {
    const { payment, payer, merchantUser } = await makeAuthorized();

    await applyTransition(db, payment, "FAILED", { reason: "cancelled by payer" });

    const expected = expect.objectContaining({
      payment_id: payment.id,
      from_status: "AUTHORIZED",
      to_status: "FAILED",
      amount_php: 150,
      failure_reason: "cancelled by payer",
    });
    expect(captureUserEvent).toHaveBeenCalledWith(
      "payment_status_changed",
      { id: payer.id, role: "PAYER" },
      expected,
    );
    expect(captureUserEvent).toHaveBeenCalledWith(
      "merchant_payment_status_changed",
      { id: merchantUser.id, role: "MERCHANT" },
      expected,
    );
  });
});
