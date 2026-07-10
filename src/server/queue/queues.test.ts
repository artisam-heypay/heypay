import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { newPaymentReference } from "@/server/payments/reference";

const { add } = vi.hoisted(() => ({
  add: vi.fn(async (_name?: string, _data?: unknown, _opts?: { jobId?: string }) => {}),
}));
vi.mock("bullmq", () => ({
  Queue: vi
    .fn()
    .mockImplementation((name: string) => ({ name, add, close: vi.fn(async () => {}) })),
  Worker: vi.fn(),
}));
vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({ quit: vi.fn(async () => {}) })),
}));

import { QUEUE_NAMES, enqueueSettle } from "./queues";

describe("queues", () => {
  beforeEach(async () => {
    await resetDb();
    add.mockClear();
  });

  it("exposes the locked QUEUE_NAMES", () => {
    expect(QUEUE_NAMES).toEqual({
      settle: "settle",
      depositPoll: "deposit-poll",
      reconcile: "reconcile",
    });
  });

  it("enqueueSettle uses jobId `${paymentId}-${status}` for idempotency", async () => {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant();
    const p = await db.payment.create({
      data: {
        reference: newPaymentReference(),
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: "100.00",
        quotedRate: "12.00000000",
        amountAsset: "8.3333334",
        networkFeeXlm: "0.0000100",
        status: "AUTHORIZED",
      },
    });
    await enqueueSettle(p.id);
    expect(add).toHaveBeenCalledTimes(1);
    const [, , optsArg] = add.mock.calls[0]!;
    expect(optsArg?.jobId).toBe(`${p.id}-AUTHORIZED`);
  });
});
