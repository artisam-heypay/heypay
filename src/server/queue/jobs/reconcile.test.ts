import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { newPaymentReference } from "@/server/payments/reference";

const { getBalance } = vi.hoisted(() => ({ getBalance: vi.fn() }));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: { getBalance: (pk: string) => getBalance(pk) },
}));

const { getTradeStatus, getPayoutStatus } = vi.hoisted(() => ({
  getTradeStatus: vi.fn(),
  getPayoutStatus: vi.fn(),
}));
vi.mock("@/server/rails", () => ({
  rail: {
    getTradeStatus: (r: string) => getTradeStatus(r),
    getPayoutStatus: (r: string) => getPayoutStatus(r),
  },
}));

const { enqueueSettle } = vi.hoisted(() => ({
  enqueueSettle: vi.fn(async (_id: string) => {}),
}));
vi.mock("@/server/queue/queues", () => ({
  QUEUE_NAMES: { settle: "settle", depositPoll: "deposit-poll", reconcile: "reconcile" },
  enqueueSettle: (id: string) => enqueueSettle(id),
}));

import { processReconcileJob } from "./reconcile";

async function makeInFlightPayment(opts: {
  status: "PDAX_TRADING" | "PAYOUT_SUBMITTED" | "PDAX_TRADED";
  pdaxTradeRef?: string;
  pdaxCashoutRef?: string;
  ageMs?: number; // how far in the past updatedAt sits (default: fresh)
}) {
  const { user } = await makePayer();
  const { merchant } = await makeMerchant();
  return db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: "100.00",
      quotedRate: "12.00000000",
      amountXlm: "8.3333334",
      networkFeeXlm: "0.0000100",
      status: opts.status,
      pdaxTradeRef: opts.pdaxTradeRef ?? null,
      pdaxCashoutRef: opts.pdaxCashoutRef ?? null,
      ...(opts.ageMs ? { updatedAt: new Date(Date.now() - opts.ageMs) } : {}),
    },
  });
}

describe("processReconcileJob — wallet (XLM) leg", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
  });

  it("flags drift between cached balance and Horizon to AuditLog", async () => {
    const { wallet } = await makePayer({ cachedXlm: "10.0000000" });
    getBalance.mockResolvedValue(dec("9")); // Horizon says 9, cache says 10 → drift

    const res = await processReconcileJob();
    expect(res.checked).toBe(1);
    expect(res.drift).toBe(1);

    const logs = await db.auditLog.findMany({
      where: { action: "reconcile.drift", target: wallet.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata).toMatchObject({ cachedXlm: "10.0000000", horizonXlm: "9.0000000" });
  });

  it("records no drift when balances match", async () => {
    await makePayer({ cachedXlm: "10.0000000" });
    getBalance.mockResolvedValue(dec("10"));
    const res = await processReconcileJob();
    expect(res.drift).toBe(0);
    expect(await db.auditLog.count({ where: { action: "reconcile.drift" } })).toBe(0);
  });
});

describe("processReconcileJob — payment (PDAX) leg", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
    getBalance.mockResolvedValue(dec("1000")); // makePayer default cache → no wallet drift
  });

  it("re-drives a stale PDAX_TRADING payment the rail has already filled", async () => {
    getTradeStatus.mockResolvedValue({ state: "FILLED", feePhp: dec("1"), filledPhp: dec("100") });
    const payment = await makeInFlightPayment({
      status: "PDAX_TRADING",
      pdaxTradeRef: "TRADE-STALE",
      ageMs: 5 * 60_000,
    });

    const res = await processReconcileJob();

    expect(res.paymentsChecked).toBe(1);
    expect(res.paymentDrift).toBe(1);
    expect(getTradeStatus).toHaveBeenCalledWith("TRADE-STALE");
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
    const logs = await db.auditLog.findMany({
      where: { action: "reconcile.payment_drift", target: payment.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata).toMatchObject({
      localStatus: "PDAX_TRADING",
      railKind: "trade",
      railState: "FILLED",
    });
  });

  it("re-drives a stale PAYOUT_SUBMITTED payment the rail has failed", async () => {
    getPayoutStatus.mockResolvedValue({ state: "FAILED" });
    const payment = await makeInFlightPayment({
      status: "PAYOUT_SUBMITTED",
      pdaxCashoutRef: "PAYOUT-STALE",
      ageMs: 5 * 60_000,
    });

    const res = await processReconcileJob();

    expect(res.paymentDrift).toBe(1);
    expect(getPayoutStatus).toHaveBeenCalledWith("PAYOUT-STALE");
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
  });

  it("re-enqueues a stale stuck payment with no rail ref to poll", async () => {
    const payment = await makeInFlightPayment({ status: "PDAX_TRADED", ageMs: 5 * 60_000 });

    const res = await processReconcileJob();

    expect(res.paymentDrift).toBe(1);
    expect(getTradeStatus).not.toHaveBeenCalled();
    expect(getPayoutStatus).not.toHaveBeenCalled();
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
    const logs = await db.auditLog.findMany({
      where: { action: "reconcile.payment_drift", target: payment.id },
    });
    expect(logs[0]!.metadata).toMatchObject({ railKind: "none", railState: "stuck" });
  });

  it("leaves a recently-updated in-flight payment alone (rail still pending)", async () => {
    getTradeStatus.mockResolvedValue({ state: "PENDING" });
    await makeInFlightPayment({ status: "PDAX_TRADING", pdaxTradeRef: "TRADE-FRESH" });

    const res = await processReconcileJob();

    expect(res.paymentsChecked).toBe(0); // not yet stale
    expect(res.paymentDrift).toBe(0);
    expect(getTradeStatus).not.toHaveBeenCalled();
    expect(enqueueSettle).not.toHaveBeenCalled();
  });

  it("does not act when a stale payment's rail leg is still pending", async () => {
    getTradeStatus.mockResolvedValue({ state: "PENDING" });
    await makeInFlightPayment({
      status: "PDAX_TRADING",
      pdaxTradeRef: "TRADE-PENDING",
      ageMs: 5 * 60_000,
    });

    const res = await processReconcileJob();

    expect(res.paymentsChecked).toBe(1);
    expect(res.paymentDrift).toBe(0);
    expect(getTradeStatus).toHaveBeenCalledWith("TRADE-PENDING");
    expect(enqueueSettle).not.toHaveBeenCalled();
  });
});
