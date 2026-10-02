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

const { getPayoutStatus } = vi.hoisted(() => ({ getPayoutStatus: vi.fn() }));
vi.mock("@/server/rails", () => ({
  fastSettleEnabled: () => false,
  rail: { getPayoutStatus: (r: string) => getPayoutStatus(r) },
}));

vi.mock("@/server/queue/queues", () => ({
  QUEUE_NAMES: { settle: "settle", depositPoll: "deposit-poll", reconcile: "reconcile" },
  enqueueSettle: vi.fn(async () => {}),
}));

import { escrowSelfRefundState, selfRefundEscrow } from "./escrow-self-refund";
import { processSettleJob } from "@/server/queue/jobs/settle";
import { escrowJobId, EscrowContractError } from "@/server/stellar/escrow";

const DEADLINE = 1_000;

/** A payment whose crypto is held in the escrow and already debited from the payer. */
async function makeEscrowed(status: PaymentStatus = "PAYOUT_SUBMITTED") {
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
      payoutRef: "disb-1",
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

    expect(result).toEqual({ refundTxHash: "SELFREFUND1" });
    const call = escrow.refundAfterTimeout.mock.calls[0]![0];
    expect(call.jobId.equals(escrowJobId(payment.id))).toBe(true);
    expect(call.encryptedSecret).toBe(wallet.encryptedSecret); // signed by the payer
    expect(escrow.refund).not.toHaveBeenCalled(); // the admin plays no part

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("PAYOUT_SUBMITTED"); // the payout is still the settle job's to finish
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
    return made;
  }

  it("settles and reports the shortfall when the payout succeeds anyway", async () => {
    const { wallet, payment } = await selfRefunded();
    getPayoutStatus.mockResolvedValue({ state: "SETTLED", netPhp: dec("100") });
    escrow.release.mockRejectedValue(new EscrowContractError("release", "NotHeld"));

    await processSettleJob({ data: { paymentId: payment.id } });

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("SETTLED");
    expect(after.escrowReleaseTxHash).toBeNull();
    expect(
      await db.auditLog.count({ where: { action: "payment.escrow_refunded_before_release" } }),
    ).toBe(1);
    expect(await balanceOf(wallet.id)).toBe("100.0000000");
  });

  it("closes as REFUNDED without a second credit when the payout fails", async () => {
    const { wallet, payment } = await selfRefunded();
    getPayoutStatus.mockResolvedValue({ state: "FAILED", failureCode: "INVALID_DESTINATION" });
    confirmTx.mockResolvedValue(true);

    // PAYOUT_SUBMITTED → REFUND_PENDING → REFUNDED
    await processSettleJob({ data: { paymentId: payment.id } });
    await processSettleJob({ data: { paymentId: payment.id } });

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("REFUNDED");
    expect(after.refundTxHash).toBe("SELFREFUND2");
    expect(escrow.refund).not.toHaveBeenCalled(); // already refunded by the payer
    expect(
      await db.walletTransaction.count({ where: { paymentId: payment.id, type: "REFUND_CREDIT" } }),
    ).toBe(1);
    expect(await balanceOf(wallet.id)).toBe("100.0000000");
  });
});

describe("escrowSelfRefundState", () => {
  it("says when the refund opens, and that it is open once the deadline has passed", async () => {
    const { wallet, payment } = await makeEscrowed();
    escrow.getJob.mockResolvedValue(heldJob(wallet.stellarPublicKey));

    escrow.getLatestLedger.mockResolvedValue(DEADLINE - 6);
    expect(await escrowSelfRefundState(payment)).toEqual({
      available: false,
      secondsUntilAvailable: 30,
    });

    escrow.getLatestLedger.mockResolvedValue(DEADLINE + 3);
    expect(await escrowSelfRefundState(payment)).toEqual({
      available: true,
      secondsUntilAvailable: 0,
    });
  });

  it("is null for a payment that is not held, without asking the contract", async () => {
    const settled = await makeEscrowed("SETTLED");
    expect(await escrowSelfRefundState(settled.payment)).toBeNull();
    expect(await escrowSelfRefundState({ ...settled.payment, escrowJobId: null })).toBeNull();
    expect(escrow.getJob).not.toHaveBeenCalled();
  });

  it("is null when the contract cannot be read, so the detail view still loads", async () => {
    const { payment } = await makeEscrowed();
    escrow.getJob.mockRejectedValue(new Error("rpc down"));

    expect(await escrowSelfRefundState(payment)).toBeNull();
  });
});
