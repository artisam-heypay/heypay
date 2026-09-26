import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { encryptSecret } from "@/server/crypto/envelope";
import { newPaymentReference } from "@/server/payments/reference";

// ---- mock externals ----
const { sendAsset, confirmTx } = vi.hoisted(() => ({
  sendAsset: vi.fn(),
  confirmTx: vi.fn(),
}));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: {
    sendAsset: (i: unknown) => sendAsset(i),
    confirmTx: (h: string) => confirmTx(h),
  },
}));

const { getDepositAddress, createPayout, getPayoutStatus } = vi.hoisted(() => ({
  getDepositAddress: vi.fn(),
  createPayout: vi.fn(),
  getPayoutStatus: vi.fn(),
}));
vi.mock("@/server/rails", () => ({
  rail: {
    supportsAsset: () => true,
    getDepositAddress: (a: string) => getDepositAddress(a),
    createPayout: (i: unknown) => createPayout(i),
    getPayoutStatus: (r: string) => getPayoutStatus(r),
  },
}));

// enqueueSettle is a no-op in tests; we drive steps manually.
const { enqueueSettle } = vi.hoisted(() => ({ enqueueSettle: vi.fn(async () => {}) }));
vi.mock("@/server/queue/queues", () => ({
  QUEUE_NAMES: { settle: "settle", depositPoll: "deposit-poll", reconcile: "reconcile" },
  enqueueSettle,
}));

const TREASURY = "GHEYPAYTREASURYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const TREASURY_SECRET = "STREASURYSECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

import { processSettleJob } from "./settle";
import { isTerminal } from "@/server/payments/state-machine";

async function makeAuthorized(merchantOpts?: { payoutEmail?: string | null }) {
  // reservedXlm already includes amountAsset + fee, set at confirm time.
  const { user, wallet } = await makePayer({ cachedXlm: "100.0000000", reservedXlm: "8.3333434" });
  const { merchant } = await makeMerchant({ accountNumber: "9988776655", ...merchantOpts });
  const payment = await db.payment.create({
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
  return { user, wallet, merchant, payment };
}

/** USDC-funded payment: the USDC leg is held on WalletBalance, the fee on XLM. */
async function makeAuthorizedUsdc() {
  const { user, wallet } = await makePayer({
    cachedXlm: "10.0000000",
    reservedXlm: "0.0000100",
    assets: { USDC: { cached: "50.0000000", reserved: "1.6039000" } },
  });
  const { merchant } = await makeMerchant({ accountNumber: "9988776655" });
  const payment = await db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: user.id,
      merchantId: merchant.id,
      asset: "USDC",
      amountPhp: "100.00",
      quotedRate: "62.34000000",
      amountAsset: "1.6039000",
      networkFeeXlm: "0.0000100",
      status: "AUTHORIZED",
    },
  });
  return { user, wallet, merchant, payment };
}

async function drive(paymentId: string) {
  for (let i = 0; i < 12; i++) {
    const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (isTerminal(p.status)) break;
    await processSettleJob({ data: { paymentId } });
  }
  return db.payment.findUniqueOrThrow({ where: { id: paymentId } });
}

function mockHappyRail() {
  confirmTx.mockResolvedValue(true);
  getDepositAddress.mockResolvedValue({ address: TREASURY, memo: null });
  createPayout.mockResolvedValue({ payoutRef: "disb-1" });
  getPayoutStatus.mockResolvedValue({ state: "SETTLED", netPhp: dec("100") });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.HEYPAY_TREASURY_SECRET_ENC = encryptSecret(TREASURY_SECRET);
  return resetDb();
});
afterEach(() => {
  delete process.env.HEYPAY_TREASURY_SECRET_ENC;
});

describe("processSettleJob — happy path", () => {
  it("sends the crypto to the treasury, pays the merchant via the rail, and settles", async () => {
    sendAsset.mockResolvedValue({ txHash: "STELLARHASH1" });
    mockHappyRail();

    const { wallet, payment } = await makeAuthorized();
    const final = await drive(payment.id);

    expect(final.status).toBe("SETTLED");
    expect(final.stellarTxHash).toBe("STELLARHASH1");
    expect(final.payoutRef).toBe("disb-1");
    expect(final.netSettledPhp?.toFixed(2)).toBe("100.00");
    expect(final.settledAt).not.toBeNull();

    const sent = sendAsset.mock.calls[0]![0];
    expect(sent).toMatchObject({ destination: TREASURY, asset: "XLM", memo: payment.reference });

    const payout = createPayout.mock.calls[0]![0];
    expect(payout.ref).toBe(payment.reference);
    expect(payout.phpAmount.toFixed(2)).toBe("100.00");
    // bank account decrypted to plaintext for the rail call
    expect(payout.bank).toEqual({
      bankCode: "BPI",
      accountName: "Test Store Inc",
      accountNumber: "9988776655",
    });
    // Xendit's receipt goes to the merchant's payout email
    expect(payout.receiptEmail).toBe("store@example.com");

    const debits = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "PAYMENT_DEBIT" },
    });
    expect(debits).toHaveLength(1);
    expect(debits[0]!.amount.toFixed(7)).toBe("-8.3333434");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000"); // reservation released
    expect(w.cachedXlmBalance.toFixed(7)).toBe("91.6666566"); // 100 - 8.3333434
  });

  it("sends USDC to the treasury as USDC — no conversion", async () => {
    sendAsset.mockResolvedValue({ txHash: "USDCHASH1" });
    mockHappyRail();

    const { payment } = await makeAuthorizedUsdc();
    const final = await drive(payment.id);

    expect(final.status).toBe("SETTLED");
    expect(getDepositAddress).toHaveBeenCalledWith("USDC");
    const sent = sendAsset.mock.calls[0]![0];
    expect(sent.asset).toBe("USDC");
    expect(sent.destination).toBe(TREASURY);
    expect(sent.amount.toFixed(7)).toBe("1.6039000"); // the XLM fee is not part of it
  });

  it("does not create a second payout when the step re-runs with a payout already recorded", async () => {
    sendAsset.mockResolvedValue({ txHash: "STELLARHASH-R" });
    mockHappyRail();
    getPayoutStatus.mockResolvedValue({ state: "PENDING" });

    const { payment } = await makeAuthorized();
    await drive(payment.id); // stops at PAYOUT_SUBMITTED
    await db.payment.update({ where: { id: payment.id }, data: { status: "STELLAR_CONFIRMED" } });
    await processSettleJob({ data: { paymentId: payment.id } });

    expect(createPayout).toHaveBeenCalledTimes(1);
  });
});

describe("processSettleJob — payout still pending at Xendit", () => {
  it("waits in PAYOUT_SUBMITTED without re-queueing itself, then settles on the next nudge", async () => {
    sendAsset.mockResolvedValue({ txHash: "STELLARHASH-P" });
    mockHappyRail();
    getPayoutStatus.mockResolvedValue({ state: "PENDING" });

    const { payment } = await makeAuthorized();
    let p = await drive(payment.id);
    expect(p.status).toBe("PAYOUT_SUBMITTED");

    enqueueSettle.mockClear();
    await processSettleJob({ data: { paymentId: payment.id } });
    p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("PAYOUT_SUBMITTED");
    // No tight loop against Xendit: the webhook / reconcile job re-drives it.
    expect(enqueueSettle).not.toHaveBeenCalled();

    // The Xendit webhook (or reconcile) nudges it once the payout succeeds.
    getPayoutStatus.mockResolvedValue({ state: "SETTLED", netPhp: dec("100") });
    await processSettleJob({ data: { paymentId: payment.id } });
    p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("SETTLED");
  });
});

describe("processSettleJob — Stellar leg fails", () => {
  it("FAILED, reservation released, no debit and no payout when the tx never lands", async () => {
    sendAsset.mockResolvedValue({ txHash: "STELLARHASH2" });
    getDepositAddress.mockResolvedValue({ address: TREASURY, memo: null });
    confirmTx.mockResolvedValue(false); // tx never landed → funds never left

    const { wallet, payment } = await makeAuthorized();
    const final = await drive(payment.id);

    expect(final.status).toBe("FAILED");
    expect(final.failureReason).toMatch(/stellar/i);
    expect(
      await db.walletTransaction.count({ where: { walletId: wallet.id, type: "PAYMENT_DEBIT" } }),
    ).toBe(0);
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000");
    expect(createPayout).not.toHaveBeenCalled();
  });
});

describe("processSettleJob — payout fails → on-chain refund from the treasury", () => {
  function failingPayout(paymentTx: string, refundTx: string) {
    sendAsset.mockImplementation(async (i: { destination: string }) => ({
      txHash: i.destination === TREASURY ? paymentTx : refundTx,
    }));
    mockHappyRail();
    getPayoutStatus.mockResolvedValue({ state: "FAILED", failureCode: "INVALID_DESTINATION" });
  }

  it("sends the crypto back from the treasury and credits the payer once", async () => {
    failingPayout("PAYHASH3", "REFUNDHASH3");

    const { wallet, payment } = await makeAuthorized();
    const final = await drive(payment.id);

    expect(final.status).toBe("REFUNDED");
    expect(final.failureReason).toMatch(/INVALID_DESTINATION/);
    expect(final.refundTxHash).toBe("REFUNDHASH3");

    const refund = sendAsset.mock.calls[1]![0];
    expect(refund.destination).toBe(wallet.stellarPublicKey);
    expect(refund.asset).toBe("XLM");
    expect(refund.amount.toFixed(7)).toBe("8.3333434"); // what reached the treasury
    expect(refund.memo).toBe(`refund ${payment.reference}`);
    // signed with the treasury key, not the payer's
    expect(refund.encryptedSecret).toBe(process.env.HEYPAY_TREASURY_SECRET_ENC);

    const credits = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "REFUND_CREDIT" },
    });
    expect(credits).toHaveLength(1);
    expect(credits[0]!.amount.toFixed(7)).toBe("8.3333434");
    expect(credits[0]!.stellarTxHash).toBe("REFUNDHASH3");
    expect(await db.auditLog.count({ where: { action: "payment.refunded" } })).toBe(1);

    const toStatuses = (
      await db.paymentEvent.findMany({
        where: { paymentId: payment.id },
        orderBy: { createdAt: "asc" },
      })
    ).map((e) => e.toStatus);
    expect(toStatuses).toContain("REFUND_PENDING");
    expect(toStatuses).toContain("REFUNDED");
  });

  it("refunds USDC — not XLM — and does not return the spent network fee", async () => {
    failingPayout("USDCPAY", "USDCREFUND");

    const { wallet, payment } = await makeAuthorizedUsdc();
    const final = await drive(payment.id);

    expect(final.status).toBe("REFUNDED");
    const refund = sendAsset.mock.calls[1]![0];
    expect(refund.asset).toBe("USDC");
    expect(refund.amount.toFixed(7)).toBe("1.6039000");
    const usdc = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDC" } },
    });
    expect(usdc.cached.toFixed(7)).toBe("50.0000000"); // debited then refunded
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.cachedXlmBalance.toFixed(7)).toBe("9.9999900"); // fee stays spent
  });

  it("does not credit twice when the deposit poller already recorded the refund", async () => {
    failingPayout("PAYHASH4", "REFUNDHASH4");
    const { wallet, payment } = await makeAuthorized();

    // Drive to REFUND_PENDING, then let the "poller" see the incoming refund first.
    confirmTx.mockImplementation(async (h: string) => {
      if (h === "REFUNDHASH4") {
        await db.$transaction(async (tx) => {
          const w = await tx.custodialWallet.update({
            where: { id: wallet.id },
            data: { cachedXlmBalance: { increment: "8.3333434" } },
          });
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              type: "PREFUND_DEPOSIT",
              asset: "XLM",
              amount: "8.3333434",
              balanceAfter: w.cachedXlmBalance.toFixed(7),
              stellarTxHash: "REFUNDHASH4",
            },
          });
        });
      }
      return true;
    });

    const final = await drive(payment.id);
    expect(final.status).toBe("REFUNDED");

    const entries = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, stellarTxHash: "REFUNDHASH4" },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("REFUND_CREDIT"); // relabelled, not duplicated
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.cachedXlmBalance.toFixed(7)).toBe("100.0000000"); // 100 - 8.33 + 8.33
  });

  it("never re-sends a refund whose earlier send is unaccounted for", async () => {
    const { payment } = await makeAuthorized();
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "REFUND_PENDING", refundSubmittedAt: new Date() },
    });

    await processSettleJob({ data: { paymentId: payment.id } });

    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REFUND_PENDING"); // still owed, not FAILED
    expect(p.failureReason).toMatch(/may already have been sent/);
    expect(sendAsset).not.toHaveBeenCalled();
    expect(await db.auditLog.count({ where: { action: "payment.refund_unverified" } })).toBe(1);
  });

  it("stays REFUND_PENDING — never FAILED — when the treasury key is missing", async () => {
    delete process.env.HEYPAY_TREASURY_SECRET_ENC;
    const { payment } = await makeAuthorized();
    await db.payment.update({ where: { id: payment.id }, data: { status: "REFUND_PENDING" } });

    await processSettleJob({ data: { paymentId: payment.id } });

    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REFUND_PENDING");
    expect(p.failureReason).toMatch(/HEYPAY_TREASURY_SECRET_ENC/);
    expect(p.refundSubmittedAt).toBeNull(); // nothing was attempted
    expect(sendAsset).not.toHaveBeenCalled();
  });

  it("allows a retry after Horizon rejects the refund outright", async () => {
    const { payment } = await makeAuthorized();
    await db.payment.update({ where: { id: payment.id }, data: { status: "REFUND_PENDING" } });
    const rejected = Object.assign(new Error("tx_insufficient_balance"), {
      name: "StellarSubmitError",
    });
    sendAsset.mockRejectedValueOnce(rejected).mockResolvedValueOnce({ txHash: "REFUNDHASH5" });
    confirmTx.mockResolvedValue(true);

    await processSettleJob({ data: { paymentId: payment.id } });
    let p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REFUND_PENDING");
    expect(p.refundSubmittedAt).toBeNull(); // nothing moved, so the marker is cleared

    await processSettleJob({ data: { paymentId: payment.id } });
    p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REFUNDED");
    expect(sendAsset).toHaveBeenCalledTimes(2);
  });
});
