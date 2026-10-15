import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { newPaymentReference } from "@/server/payments/reference";

type AddOpts = { jobId?: string; delay?: number };
const { add, getJob } = vi.hoisted(() => ({
  add: vi.fn(async (_name?: string, _data?: unknown, _opts?: AddOpts) => {}),
  getJob: vi.fn(async (_id: string): Promise<unknown> => undefined),
}));
vi.mock("bullmq", () => ({
  Queue: vi
    .fn()
    .mockImplementation((name: string) => ({ name, add, getJob, close: vi.fn(async () => {}) })),
  Worker: vi.fn(),
}));
vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({ quit: vi.fn(async () => {}) })),
}));

import { QUEUE_NAMES, enqueueSettle, enqueueWalletActivation } from "./queues";

describe("queues", () => {
  beforeEach(async () => {
    await resetDb();
    add.mockClear();
    getJob.mockReset().mockResolvedValue(undefined);
  });

  async function makePayment(status: "AUTHORIZED" | "PAYOUT_SUBMITTED") {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant();
    return db.payment.create({
      data: {
        reference: newPaymentReference(),
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: "100.00",
        quotedRate: "12.00000000",
        amountAsset: "8.3333334",
        networkFeeXlm: "0.0000100",
        status,
      },
    });
  }

  it("exposes the locked QUEUE_NAMES", () => {
    expect(QUEUE_NAMES).toEqual({
      settle: "settle",
      depositPoll: "deposit-poll",
      reconcile: "reconcile",
      walletActivate: "wallet-activate",
    });
  });

  it("enqueueWalletActivation queues one job per payer", async () => {
    await enqueueWalletActivation("user_1");
    expect(add).toHaveBeenCalledWith("activate", { userId: "user_1" }, { jobId: "user_1" });
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

  it("drops a duplicate while the same step is still queued or running", async () => {
    const p = await makePayment("PAYOUT_SUBMITTED");
    getJob.mockResolvedValue({ getState: async () => "active", remove: vi.fn() });
    await enqueueSettle(p.id);
    expect(add).not.toHaveBeenCalled();
  });

  it("re-runs a step whose earlier job already finished, instead of silently dropping it", async () => {
    // BullMQ ignores an id it has completed; a payout re-check (webhook, reconcile)
    // for PAYOUT_SUBMITTED would otherwise never run.
    const p = await makePayment("PAYOUT_SUBMITTED");
    const remove = vi.fn(async () => {});
    getJob.mockResolvedValue({ getState: async () => "completed", remove });
    await enqueueSettle(p.id);
    expect(remove).toHaveBeenCalledOnce();
    expect(add.mock.calls[0]![2]).toEqual({ jobId: `${p.id}-PAYOUT_SUBMITTED` });
  });

  it("schedules a delayed re-check under its own id", async () => {
    const p = await makePayment("PAYOUT_SUBMITTED");
    await enqueueSettle(p.id, { delayMs: 30_000 });
    expect(getJob).not.toHaveBeenCalled();
    const opts = add.mock.calls[0]![2]!;
    expect(opts.delay).toBe(30_000);
    expect(opts.jobId).toMatch(new RegExp(`^${p.id}-PAYOUT_SUBMITTED-at\\d+$`));
  });
});
