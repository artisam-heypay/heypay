import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { newPaymentReference } from "@/server/payments/reference";

const { getBalances } = vi.hoisted(() => ({ getBalances: vi.fn() }));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: { getBalances: (pk: string, assets?: string[]) => getBalances(pk, assets) },
}));

/** Horizon reporting a single native-XLM balance line. */
const horizonXlm = (balance: string) => [{ asset: "XLM", balance: dec(balance), trustline: true }];

const { getPayoutStatus } = vi.hoisted(() => ({ getPayoutStatus: vi.fn() }));
vi.mock("@/server/rails", () => ({
  rail: { getPayoutStatus: (r: string) => getPayoutStatus(r) },
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
  status: "PAYOUT_SUBMITTED" | "STELLAR_CONFIRMED" | "REFUND_PENDING";
  payoutRef?: string;
  ageMs?: number; // how far in the past updatedAt sits (default: fresh)
  escrowJobId?: string;
  asset?: "USDC";
}) {
  const { user } = await makePayer();
  const { merchant } = await makeMerchant();
  return db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: user.id,
      merchantId: merchant.id,
      asset: opts.asset ?? "XLM",
      amountPhp: "100.00",
      quotedRate: "12.00000000",
      amountAsset: "8.3333334",
      networkFeeXlm: "0.0000100",
      status: opts.status,
      payoutRef: opts.payoutRef ?? null,
      escrowJobId: opts.escrowJobId ?? null,
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
    getBalances.mockResolvedValue(horizonXlm("9")); // Horizon says 9, cache says 10 → drift

    const res = await processReconcileJob();
    expect(res.checked).toBe(1);
    expect(res.drift).toBe(1);

    const logs = await db.auditLog.findMany({
      where: { action: "reconcile.drift", target: wallet.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata).toMatchObject({
      asset: "XLM",
      cached: "10.0000000",
      horizon: "9.0000000",
    });
  });

  it("flags drift on an issued asset, not just XLM", async () => {
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    process.env.USDT_ASSET_ISSUER = "GISSUERUSDT";
    const { wallet } = await makePayer({
      cachedXlm: "10.0000000",
      assets: { USDT: { cached: "5.0000000" } },
    });
    getBalances.mockResolvedValue([
      { asset: "XLM", balance: dec("10"), trustline: true },
      { asset: "USDT", balance: dec("7"), trustline: true }, // Horizon says 7, cache says 5
    ]);

    const res = await processReconcileJob();
    expect(res.drift).toBe(1);

    const logs = await db.auditLog.findMany({
      where: { action: "reconcile.drift", target: wallet.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata).toMatchObject({
      asset: "USDT",
      cached: "5.0000000",
      horizon: "7.0000000",
      delta: "2.0000000",
    });
    delete process.env.PAYMENT_ASSETS;
    delete process.env.USDT_ASSET_ISSUER;
  });

  it("records no drift when balances match", async () => {
    await makePayer({ cachedXlm: "10.0000000" });
    getBalances.mockResolvedValue(horizonXlm("10"));
    const res = await processReconcileJob();
    expect(res.drift).toBe(0);
    expect(await db.auditLog.count({ where: { action: "reconcile.drift" } })).toBe(0);
  });
});

describe("processReconcileJob — payout leg (missed-webhook fallback)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
    getBalances.mockResolvedValue(horizonXlm("1000")); // makePayer default cache → no wallet drift
  });

  it("re-drives a stale PAYOUT_SUBMITTED payment Xendit has already paid", async () => {
    getPayoutStatus.mockResolvedValue({ state: "SETTLED", netPhp: dec("100") });
    const payment = await makeInFlightPayment({
      status: "PAYOUT_SUBMITTED",
      payoutRef: "disb-stale",
      ageMs: 5 * 60_000,
    });

    const res = await processReconcileJob();

    expect(res.paymentsChecked).toBe(1);
    expect(res.paymentDrift).toBe(1);
    expect(getPayoutStatus).toHaveBeenCalledWith("disb-stale");
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
    const logs = await db.auditLog.findMany({
      where: { action: "reconcile.payment_drift", target: payment.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata).toMatchObject({
      localStatus: "PAYOUT_SUBMITTED",
      railKind: "payout",
      railState: "SETTLED",
    });
  });

  it("re-drives an escrowed payment stuck mid-release after Xendit paid", async () => {
    getPayoutStatus.mockResolvedValue({ state: "SETTLED", netPhp: dec("100") });
    const payment = await makeInFlightPayment({
      status: "PAYOUT_SUBMITTED",
      payoutRef: "disb-escrow",
      ageMs: 5 * 60_000,
      escrowJobId: "ab".repeat(32),
    });

    const res = await processReconcileJob();

    expect(res.paymentDrift).toBe(1);
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
    const log = await db.auditLog.findFirstOrThrow({
      where: { action: "reconcile.payment_drift", target: payment.id },
    });
    expect(log.metadata).toMatchObject({ railState: "SETTLED", escrowJobId: "ab".repeat(32) });
  });

  it("re-drives an escrowed payment stuck mid-refund", async () => {
    const payment = await makeInFlightPayment({
      status: "REFUND_PENDING",
      ageMs: 5 * 60_000,
      escrowJobId: "cd".repeat(32),
    });

    const res = await processReconcileJob();

    expect(res.paymentDrift).toBe(1);
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
    const log = await db.auditLog.findFirstOrThrow({
      where: { action: "reconcile.payment_drift", target: payment.id },
    });
    expect(log.metadata).toMatchObject({ railState: "stuck", escrowJobId: "cd".repeat(32) });
  });

  it("re-drives a USDC payment stuck mid-refund, naming its asset", async () => {
    const payment = await makeInFlightPayment({
      status: "REFUND_PENDING",
      ageMs: 5 * 60_000,
      escrowJobId: "ef".repeat(32),
      asset: "USDC",
    });

    const res = await processReconcileJob();

    expect(res.paymentDrift).toBe(1);
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
    const log = await db.auditLog.findFirstOrThrow({
      where: { action: "reconcile.payment_drift", target: payment.id },
    });
    expect(log.metadata).toMatchObject({
      asset: "USDC",
      railState: "stuck",
      escrowJobId: "ef".repeat(32),
    });
  });

  it("re-drives a stale PAYOUT_SUBMITTED payment whose payout failed", async () => {
    getPayoutStatus.mockResolvedValue({ state: "FAILED", failureCode: "INVALID_DESTINATION" });
    const payment = await makeInFlightPayment({
      status: "PAYOUT_SUBMITTED",
      payoutRef: "disb-failed",
      ageMs: 5 * 60_000,
    });

    const res = await processReconcileJob();

    expect(res.paymentDrift).toBe(1);
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
  });

  it.each(["STELLAR_CONFIRMED", "REFUND_PENDING"] as const)(
    "re-enqueues a stale %s payment with no payout to poll",
    async (status) => {
      const payment = await makeInFlightPayment({ status, ageMs: 5 * 60_000 });

      const res = await processReconcileJob();

      expect(res.paymentDrift).toBe(1);
      expect(getPayoutStatus).not.toHaveBeenCalled();
      expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
      const logs = await db.auditLog.findMany({
        where: { action: "reconcile.payment_drift", target: payment.id },
      });
      expect(logs[0]!.metadata).toMatchObject({ railKind: "none", railState: "stuck" });
    },
  );

  it("leaves a recently-updated payout alone", async () => {
    await makeInFlightPayment({ status: "PAYOUT_SUBMITTED", payoutRef: "disb-fresh" });

    const res = await processReconcileJob();

    expect(res.paymentsChecked).toBe(0); // not yet stale
    expect(getPayoutStatus).not.toHaveBeenCalled();
    expect(enqueueSettle).not.toHaveBeenCalled();
  });

  it("does not act while a stale payout is still pending at Xendit", async () => {
    getPayoutStatus.mockResolvedValue({ state: "PENDING" });
    await makeInFlightPayment({
      status: "PAYOUT_SUBMITTED",
      payoutRef: "disb-pending",
      ageMs: 5 * 60_000,
    });

    const res = await processReconcileJob();

    expect(res.paymentsChecked).toBe(1);
    expect(res.paymentDrift).toBe(0);
    expect(getPayoutStatus).toHaveBeenCalledWith("disb-pending");
    expect(enqueueSettle).not.toHaveBeenCalled();
  });
});
