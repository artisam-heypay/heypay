import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { newPaymentReference } from "@/server/payments/reference";

// `vi.mock` is hoisted above imports, so the `add` spy is created via `vi.hoisted`.
// Mocks use classes (not arrow `vi.fn` impls) because queues.ts constructs them with `new`.
const { add } = vi.hoisted(() => ({
  add: vi.fn<(name: string, data: unknown, opts: { jobId: string }) => Promise<void>>(),
}));
vi.mock("bullmq", () => ({
  Queue: class {
    name: string;
    add = add;
    close = vi.fn(async () => {});
    constructor(name: string) {
      this.name = name;
    }
  },
  Worker: class {},
}));
vi.mock("ioredis", () => ({
  default: class {
    quit = vi.fn(async () => {});
  },
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

  it("enqueueSettle uses jobId `${paymentId}:${status}` for idempotency", async () => {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant();
    const p = await db.payment.create({
      data: {
        reference: newPaymentReference(),
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: "100.00",
        quotedRate: "12.00000000",
        amountXlm: "8.3333334",
        networkFeeXlm: "0.0000100",
        status: "AUTHORIZED",
      },
    });
    await enqueueSettle(p.id);
    expect(add).toHaveBeenCalledTimes(1);
    const optsArg = add.mock.calls[0]![2];
    expect(optsArg.jobId).toBe(`${p.id}:AUTHORIZED`);
  });
});
