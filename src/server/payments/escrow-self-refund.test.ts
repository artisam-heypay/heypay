import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { encryptSecret } from "@/server/crypto/envelope";
import { newPaymentReference } from "@/server/payments/reference";
import type { PaymentStatus } from "@/generated/prisma/client";

// ---- mock externals ----
const { confirmTx } = vi.hoisted(() => ({ confirmTx: vi.fn() }));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: { sendAsset: vi.fn(), confirmTx: (h: string) => confirmTx(h) },
}));

const escrow = vi.hoisted(() => ({
  release: vi.fn(),
  refund: vi.fn(),
  refundAfterTimeout: vi.fn(),
  getJob: vi.fn(),
  getLatestLedger: vi.fn(),
  getFeeCharged: vi.fn(),
}));
vi.mock("@/server/stellar/escrow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/stellar/escrow")>()),
  escrowService: escrow,
}));

const { getPayoutStatus, cancelPayout } = vi.hoisted(() => ({
  getPayoutStatus: vi.fn(),
  cancelPayout: vi.fn(),
}));
vi.mock("@/server/rails", () => ({
  fastSettleEnabled: () => false,
  rail: {
    getPayoutStatus: (r: string) => getPayoutStatus(r),
    cancelPayout: (r: string) => cancelPayout(r),
  },
}));

const { enqueueSettle } = vi.hoisted(() => ({
  enqueueSettle: vi.fn(async (_id: string, _opts?: { delayMs?: number }) => {}),
}));
vi.mock("@/server/queue/queues", () => ({
  QUEUE_NAMES: { settle: "settle", depositPoll: "deposit-poll", reconcile: "reconcile" },
  enqueueSettle,
}));

import { escrowSelfRefundState, selfRefundEscrow } from "./escrow-self-refund";
import { processSettleJob } from "@/server/queue/jobs/settle";
import { escrowJobId, EscrowContractError } from "@/server/stellar/escrow";

const DEADLINE = 1_000;

/** A payment whose crypto is held in the escrow and already debited from the payer. */
/**
 * `payout`: "sent" has a payout at the rail, "requesting" has a request the settle
 * job started but did not record yet, "none" was never requested. Default: sent,
 * except for a payment still at STELLAR_CONFIRMED.
 */
async function makeEscrowed(
  status: PaymentStatus = "PAYOUT_SUBMITTED",
  payout: "sent" | "requesting" | "none" = status === "STELLAR_CONFIRMED" ? "none" : "sent",
) {
  const { user, wallet } = await makePayer({ cachedXlm: "91.6666566", reservedXlm: "0.0000000" });
  const { merchant } = await makeMerchant({ accountNumber: "9988776655" });
  const created = await db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: "100.00",
      quotedRate: "12.00000000",
      amountAsset: "8.3333334",
      networkFeeXlm: "0.0000100",
      status,
      stellarTxHash: `DEPOSIT-${user.id}`,
      payoutRef: payout === "sent" ? "disb-1" : null,
      payoutRequestedAt: payout === "none" ? null : new Date(),
    },
  });
  const payment = await db.payment.update({
    where: { id: created.id },
    data: { escrowJobId: escrowJobId(created.id).toString("hex") },
  });
  return { user, wallet, payment };
}

function heldJob(from: string, status = "Held") {
  return { from, amount: dec("8.3333434"), deadlineLedger: DEADLINE, status };
}

async function balanceOf(walletId: string): Promise<string> {
  const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: walletId } });
  return w.cachedXlmBalance.toFixed(7);
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const fn of Object.values(escrow)) fn.mockReset();
  process.env.HEYPAY_TREASURY_SECRET_ENC = encryptSecret("STREASURYSECRET");
  escrow.getFeeCharged.mockResolvedValue(null);
  // The rail stops the payout, unless a test says otherwise.
  cancelPayout.mockReset().mockResolvedValue({ state: "FAILED", failureCode: "CANCELLED" });
  getPayoutStatus.mockReset();
  await resetDb();
});
afterEach(() => {
  delete process.env.HEYPAY_TREASURY_SECRET_ENC;
});

describe("selfRefundEscrow", () => {
  it("refunds from the escrow with the payer's key and credits the balance once", async () => {
    const { user, wallet, payment } = await makeEscrowed();
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    escrow.refundAfterTimeout.mockResolvedValue({ txHash: "SELFREFUND1" });
    escrow.getFeeCharged.mockResolvedValue(dec("0.0025226"));

    const result = await selfRefundEscrow({ id: payment.id, payerId: user.id });

    expect(result).toEqual({
      refundTxHash: "SELFREFUND1",
      status: "REFUND_PENDING",
      failureReason: "Escrow deadline passed before the payment settled",
    });
    const call = escrow.refundAfterTimeout.mock.calls[0]![0];
    expect(call.jobId.equals(escrowJobId(payment.id))).toBe(true);
    expect(call.encryptedSecret).toBe(wallet.encryptedSecret); // signed by the payer
    expect(escrow.refund).not.toHaveBeenCalled(); // the admin plays no part

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    // The payment has expired; the settle job closes it as REFUNDED.
    expect(after.status).toBe("REFUND_PENDING");
    expect(after.failureReason).toBe("Escrow deadline passed before the payment settled");
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
    expect(after.refundTxHash).toBe("SELFREFUND1");
    // 91.6666566 + 8.3333434 (amount + base fee) - 0.0025226 (refund's Soroban fee)
    expect(await balanceOf(wallet.id)).toBe("99.9974774");

    const credits = await db.walletTransaction.findMany({
      where: { paymentId: payment.id, type: "REFUND_CREDIT" },
    });
    expect(credits).toHaveLength(1);
    expect(credits[0]!.amount.toFixed(7)).toBe("8.3333434");
    expect(credits[0]!.stellarTxHash).toBe("SELFREFUND1");
    const audits = await db.auditLog.findMany({ where: { action: "payment.escrow_self_refund" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(user.id);
  });

  it("refunds a payment whose payout was never requested, without asking the rail", async () => {
    const { user, wallet, payment } = await makeEscrowed("STELLAR_CONFIRMED");
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    escrow.refundAfterTimeout.mockResolvedValue({ txHash: "SELFREFUND-N" });

    const result = await selfRefundEscrow({ id: payment.id, payerId: user.id });

    expect(result.refundTxHash).toBe("SELFREFUND-N");
    expect(cancelPayout).not.toHaveBeenCalled();
    expect(await balanceOf(wallet.id)).toBe("100.0000000");
  });

  it("refuses while a payout request is being sent and is not recorded yet", async () => {
    const { user, wallet, payment } = await makeEscrowed("STELLAR_CONFIRMED", "requesting");
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);

    await expect(selfRefundEscrow({ id: payment.id, payerId: user.id })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("already on its way"),
    });
    expect(escrow.refundAfterTimeout).not.toHaveBeenCalled();
    expect(await balanceOf(wallet.id)).toBe("91.6666566");
  });

  it("loses to a payout request that starts while it is still checking", async () => {
    const { user, wallet, payment } = await makeEscrowed("STELLAR_CONFIRMED");
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    // The settle job claims the payout request in the middle of this refund.
    escrow.getLatestLedger.mockImplementation(async () => {
      await db.payment.update({
        where: { id: payment.id },
        data: { payoutRequestedAt: new Date() },
      });
      return DEADLINE;
    });

    await expect(selfRefundEscrow({ id: payment.id, payerId: user.id })).rejects.toMatchObject({
      status: 409,
    });
    // Nothing went back to the payer, and no refund claim is left behind.
    expect(escrow.refundAfterTimeout).not.toHaveBeenCalled();
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.refundSubmittedAt).toBeNull();
    expect(after.refundTxHash).toBeNull();
  });

  it("stops the payout before refunding, so the merchant is not paid", async () => {
    const { user, wallet, payment } = await makeEscrowed();
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    cancelPayout.mockResolvedValue({ state: "FAILED", failureCode: "CANCELLED" });
    escrow.refundAfterTimeout.mockResolvedValue({ txHash: "SELFREFUND-C" });

    await selfRefundEscrow({ id: payment.id, payerId: user.id });

    expect(cancelPayout).toHaveBeenCalledWith("disb-1");
    expect(cancelPayout.mock.invocationCallOrder[0]!).toBeLessThan(
      escrow.refundAfterTimeout.mock.invocationCallOrder[0]!,
    );
  });

  it("completes the payment instead when the merchant has already been paid", async () => {
    const { user, wallet, payment } = await makeEscrowed();
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    cancelPayout.mockResolvedValue({ state: "SETTLED", netPhp: dec("100") });

    await expect(selfRefundEscrow({ id: payment.id, payerId: user.id })).rejects.toMatchObject({
      status: 409,
    });
    expect(escrow.refundAfterTimeout).not.toHaveBeenCalled();
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
    expect(await balanceOf(wallet.id)).toBe("91.6666566");
  });

  it("refuses while the bank transfer is in progress and cannot be stopped", async () => {
    const { user, wallet, payment } = await makeEscrowed();
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    cancelPayout.mockResolvedValue({ state: "PENDING", railStatus: "REQUESTED" });

    await expect(selfRefundEscrow({ id: payment.id, payerId: user.id })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("already on its way and can't be stopped"),
    });
    // Nothing was refunded: the payer cannot end up with the crypto and the goods.
    expect(escrow.refundAfterTimeout).not.toHaveBeenCalled();
    expect(await balanceOf(wallet.id)).toBe("91.6666566");
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("PAYOUT_SUBMITTED");
    expect(after.refundSubmittedAt).toBeNull();
  });

  it("refuses when the rail cannot say whether the payout was stopped", async () => {
    const { user, wallet, payment } = await makeEscrowed();
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    cancelPayout.mockRejectedValue(new Error("xendit down"));

    await expect(selfRefundEscrow({ id: payment.id, payerId: user.id })).rejects.toMatchObject({
      status: 409,
    });
    expect(escrow.refundAfterTimeout).not.toHaveBeenCalled();
  });

  it("refuses before the deadline ledger, without calling the contract", async () => {
    const { user, wallet, payment } = await makeEscrowed();
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE - 12);

    await expect(selfRefundEscrow({ id: payment.id, payerId: user.id })).rejects.toMatchObject({
      status: 409,
      message: "The escrow refund opens in about 60 seconds.",
    });
    expect(escrow.refundAfterTimeout).not.toHaveBeenCalled();
    expect(await balanceOf(wallet.id)).toBe("91.6666566");
  });

  it("refuses another payer's payment", async () => {
    const { payment } = await makeEscrowed();
    const other = await makePayer();

    await expect(
      selfRefundEscrow({ id: payment.id, payerId: other.user.id }),
    ).rejects.toMatchObject({ status: 403 });
    expect(escrow.getJob).not.toHaveBeenCalled();
  });

  it("refuses a payment the escrow no longer holds", async () => {
    const { user, wallet, payment } = await makeEscrowed();
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey, "Released"));

    await expect(selfRefundEscrow({ id: payment.id, payerId: user.id })).rejects.toMatchObject({
      status: 409,
    });
    expect(escrow.refundAfterTimeout).not.toHaveBeenCalled();
  });

  it.each(["SETTLED", "REFUNDED", "STELLAR_SUBMITTED"] as const)(
    "refuses a %s payment",
    async (status) => {
      const { user, payment } = await makeEscrowed(status);

      await expect(selfRefundEscrow({ id: payment.id, payerId: user.id })).rejects.toMatchObject({
        status: 409,
      });
      expect(escrow.getJob).not.toHaveBeenCalled();
    },
  );

  it("drops its claim when the contract rejects the refund, so it can be tried again", async () => {
    const { user, wallet, payment } = await makeEscrowed();
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    escrow.refundAfterTimeout.mockRejectedValue(
      new EscrowContractError("refund_after_timeout", "DeadlineNotReached"),
    );

    await expect(selfRefundEscrow({ id: payment.id, payerId: user.id })).rejects.toMatchObject({
      status: 409,
    });
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.refundSubmittedAt).toBeNull();
    expect(after.refundTxHash).toBeNull();
    expect(await balanceOf(wallet.id)).toBe("91.6666566");
  });

  it("refuses while another refund of the payment is in flight", async () => {
    const { user, wallet, payment } = await makeEscrowed();
    await db.payment.update({ where: { id: payment.id }, data: { refundSubmittedAt: new Date() } });
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);

    await expect(selfRefundEscrow({ id: payment.id, payerId: user.id })).rejects.toMatchObject({
      status: 409,
    });
    expect(escrow.refundAfterTimeout).not.toHaveBeenCalled();
  });
});

describe("settle job after a payer's own escrow refund", () => {
  async function selfRefunded() {
    const made = await makeEscrowed();
    escrow.getJob.mockResolvedValue(heldJob(made.wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    escrow.refundAfterTimeout.mockResolvedValue({ txHash: "SELFREFUND2" });
    await selfRefundEscrow({ id: made.payment.id, payerId: made.user.id });
    escrow.getJob.mockResolvedValue(heldJob(made.wallet.stellarPublicKey, "Refunded"));
    confirmTx.mockResolvedValue(true);
    return made;
  }

  it("closes the payment as REFUNDED without refunding or crediting a second time", async () => {
    const { wallet, payment } = await selfRefunded();
    getPayoutStatus.mockResolvedValue({ state: "PENDING" });

    await processSettleJob({ data: { paymentId: payment.id } });

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("REFUNDED");
    expect(after.refundTxHash).toBe("SELFREFUND2");
    expect(escrow.refund).not.toHaveBeenCalled();
    expect(escrow.refundAfterTimeout).toHaveBeenCalledTimes(1); // the payer's own call
    expect(
      await db.walletTransaction.count({ where: { paymentId: payment.id, type: "REFUND_CREDIT" } }),
    ).toBe(1);
    expect(await balanceOf(wallet.id)).toBe("100.0000000");
  });

  // The rail said the payout was stopped; should it be paid all the same, that
  // must not go unnoticed.
  it("records a payout that is still paid after the refund", async () => {
    const { payment } = await selfRefunded();
    getPayoutStatus.mockResolvedValue({ state: "SETTLED", netPhp: dec("100") });

    await processSettleJob({ data: { paymentId: payment.id } }); // → REFUNDED
    await processSettleJob({ data: { paymentId: payment.id } }); // the payout's real end

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("REFUNDED");
    expect(escrow.release).not.toHaveBeenCalled();
    expect(
      await db.auditLog.count({
        where: { action: "payment.expired_payout_outcome", target: payment.id },
      }),
    ).toBe(1);
  });

  it("never settles a payment whose release finds the payer already refunded", async () => {
    // The settle job is still on the payout when the payer's refund lands on-chain.
    const { wallet, payment } = await makeEscrowed();
    getPayoutStatus.mockResolvedValue({ state: "SETTLED", netPhp: dec("100") });
    escrow.release.mockRejectedValue(new EscrowContractError("release", "NotHeld"));
    escrow.refund.mockRejectedValue(new EscrowContractError("refund", "NotHeld"));
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey, "Refunded"));

    await processSettleJob({ data: { paymentId: payment.id } }); // release refused → REFUND_PENDING
    await processSettleJob({ data: { paymentId: payment.id } }); // → REFUNDED

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("REFUNDED");
    expect(after.settledAt).toBeNull();
    expect(
      await db.auditLog.count({ where: { action: "payment.escrow_refunded_before_release" } }),
    ).toBe(1);
    // The crypto came back on-chain, so the balance is credited, once.
    expect(await balanceOf(wallet.id)).toBe("100.0000000");
  });

  it("takes back a payment cancelled at the deadline, which the settle job then closes", async () => {
    const { user, wallet, payment } = await makeEscrowed("REFUND_PENDING");
    await db.paymentEvent.create({
      data: {
        paymentId: payment.id,
        fromStatus: "PAYOUT_SUBMITTED",
        toStatus: "REFUND_PENDING",
        detail: { awaitsPayerRefund: true },
      },
    });
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);

    // Until the payer acts, the settle job leaves the crypto in the escrow.
    await processSettleJob({ data: { paymentId: payment.id } });
    expect(escrow.refund).not.toHaveBeenCalled();
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      "REFUND_PENDING",
    );

    escrow.refundAfterTimeout.mockResolvedValue({ txHash: "SELFREFUND-E" });
    confirmTx.mockResolvedValue(true);
    await selfRefundEscrow({ id: payment.id, payerId: user.id });
    // The rail is asked again, to be sure the stopped payout is still not payable.
    expect(cancelPayout).toHaveBeenCalledWith("disb-1");
    await processSettleJob({ data: { paymentId: payment.id } });

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("REFUNDED");
    expect(after.refundTxHash).toBe("SELFREFUND-E");
    expect(escrow.refund).not.toHaveBeenCalled();
    expect(await balanceOf(wallet.id)).toBe("100.0000000");
  });

  it("leaves a payment that was already being refunded in REFUND_PENDING", async () => {
    const { user, wallet, payment } = await makeEscrowed("REFUND_PENDING");
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    escrow.refundAfterTimeout.mockResolvedValue({ txHash: "SELFREFUND3" });

    await selfRefundEscrow({ id: payment.id, payerId: user.id });

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("REFUND_PENDING");
    expect(await balanceOf(wallet.id)).toBe("100.0000000");
  });
});

describe("escrowSelfRefundState", () => {
  it("says when the refund opens, and that it is open once the deadline has passed", async () => {
    // No payout has been requested yet, so nothing stands in the refund's way.
    const { wallet, payment } = await makeEscrowed("STELLAR_CONFIRMED");
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));

    escrow.getLatestLedger.mockResolvedValue(DEADLINE - 6);
    expect(await escrowSelfRefundState(payment)).toEqual({
      available: false,
      secondsUntilAvailable: 30,
      waitingOnPayout: false,
    });

    escrow.getLatestLedger.mockResolvedValue(DEADLINE + 3);
    expect(await escrowSelfRefundState(payment)).toEqual({
      available: true,
      secondsUntilAvailable: 0,
      waitingOnPayout: false,
    });
    expect(getPayoutStatus).not.toHaveBeenCalled();
  });

  it("makes the payer wait while the bank transfer is in progress past the deadline", async () => {
    const { wallet, payment } = await makeEscrowed();
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    getPayoutStatus.mockResolvedValue({ state: "PENDING", railStatus: "REQUESTED" });

    expect(await escrowSelfRefundState(payment)).toEqual({
      available: false,
      secondsUntilAvailable: 0,
      waitingOnPayout: true,
    });
  });

  it("keeps the payer waiting however long the bank transfer has been in progress", async () => {
    const { wallet, payment } = await makeEscrowed();
    await db.paymentEvent.create({
      data: {
        paymentId: payment.id,
        fromStatus: "STELLAR_CONFIRMED",
        toStatus: "PAYOUT_SUBMITTED",
        createdAt: new Date(Date.now() - 72 * 60 * 60_000),
      },
    });
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    getPayoutStatus.mockResolvedValue({ state: "PENDING", railStatus: "REQUESTED" });

    expect(await escrowSelfRefundState(payment)).toMatchObject({
      available: false,
      waitingOnPayout: true,
    });
  });

  it("opens the refund for a payout that failed but is not refunded yet", async () => {
    const { wallet, payment } = await makeEscrowed();
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    getPayoutStatus.mockResolvedValue({ state: "FAILED", failureCode: "CANCELLED" });

    expect(await escrowSelfRefundState(payment)).toEqual({
      available: true,
      secondsUntilAvailable: 0,
      waitingOnPayout: false,
    });
  });

  it("makes the payer wait while a payout request is being sent", async () => {
    const { wallet, payment } = await makeEscrowed("STELLAR_CONFIRMED", "requesting");
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);

    expect(await escrowSelfRefundState(payment)).toEqual({
      available: false,
      secondsUntilAvailable: 0,
      waitingOnPayout: true,
    });
    expect(getPayoutStatus).not.toHaveBeenCalled(); // there is no payout id to ask about yet
  });

  it("offers nothing for a payout that has just been paid", async () => {
    const { wallet, payment } = await makeEscrowed();
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    getPayoutStatus.mockResolvedValue({ state: "SETTLED", netPhp: dec("100") });

    expect(await escrowSelfRefundState(payment)).toBeNull();
  });

  it("is null for a payment that is not held, without asking the contract", async () => {
    const settled = await makeEscrowed("SETTLED");
    expect(await escrowSelfRefundState(settled.payment)).toBeNull();
    expect(await escrowSelfRefundState({ ...settled.payment, escrowJobId: null })).toBeNull();
    expect(escrow.getJob).not.toHaveBeenCalled();
  });

  it("shows no countdown for a refund HeyPay is already sending", async () => {
    const { wallet, payment } = await makeEscrowed("REFUND_PENDING");
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));

    escrow.getLatestLedger.mockResolvedValue(DEADLINE - 6);
    expect(await escrowSelfRefundState(payment)).toBeNull();

    // Past the deadline the payer can take it themselves: the payout has failed.
    escrow.getLatestLedger.mockResolvedValue(DEADLINE);
    getPayoutStatus.mockResolvedValue({ state: "FAILED", failureCode: "MOCK_FAILURE" });
    expect(await escrowSelfRefundState(payment)).toEqual({
      available: true,
      secondsUntilAvailable: 0,
      waitingOnPayout: false,
    });
  });

  it("is null when the contract cannot be read, so the detail view still loads", async () => {
    const { payment } = await makeEscrowed();
    escrow.getJob.mockRejectedValue(new Error("rpc down"));

    expect(await escrowSelfRefundState(payment)).toBeNull();
  });
});
