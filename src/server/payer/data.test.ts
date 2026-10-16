import { beforeEach, describe, expect, it } from "vitest";
import { makeMerchant, makePayer, resetDb } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { newPaymentReference } from "@/server/payments/reference";
import type { PaymentStatus } from "@/generated/prisma/client";
import { getPayerPayments, getRecentPayments } from "./data";

async function pay(payerId: string, merchantId: string, status: PaymentStatus, minutesAgo: number) {
  return db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId,
      merchantId,
      amountPhp: "50.00",
      quotedRate: "12.00000000",
      amountAsset: "4.1666667",
      status,
      createdAt: new Date(Date.now() - minutesAgo * 60_000),
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("payer payment lists", () => {
  it("leave out prices the payer never confirmed or called off", async () => {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant();
    // What Van's History held after two real payments: each switch of coin,
    // cancel and unconfirmed price made a payment that took no money.
    const refunded = await pay(user.id, merchant.id, "REFUNDED", 1);
    await pay(user.id, merchant.id, "CANCELLED", 2);
    const settled = await pay(user.id, merchant.id, "SETTLED", 3);
    await pay(user.id, merchant.id, "CANCELLED", 4);
    await pay(user.id, merchant.id, "QUOTED", 5);
    await pay(user.id, merchant.id, "CREATED", 6);
    // Money moved in these, so they stay.
    const failed = await pay(user.id, merchant.id, "FAILED", 7);
    const refunding = await pay(user.id, merchant.id, "REFUND_PENDING", 8);

    const shown = [refunded.id, settled.id, failed.id, refunding.id];
    expect((await getRecentPayments(user.id, 10)).map((p) => p.id)).toEqual(shown);
    expect((await getPayerPayments(user.id, { limit: 10 })).items.map((p) => p.id)).toEqual(shown);
  });

  it("pages through the payments that are shown", async () => {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant();
    const first = await pay(user.id, merchant.id, "SETTLED", 1);
    await pay(user.id, merchant.id, "CANCELLED", 2);
    const second = await pay(user.id, merchant.id, "SETTLED", 3);
    await pay(user.id, merchant.id, "CANCELLED", 4);
    const third = await pay(user.id, merchant.id, "REFUNDED", 5);

    const page1 = await getPayerPayments(user.id, { limit: 2 });
    expect(page1.items.map((p) => p.id)).toEqual([first.id, second.id]);
    const page2 = await getPayerPayments(user.id, { limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((p) => p.id)).toEqual([third.id]);
    expect(page2.nextCursor).toBeUndefined();
  });
});
