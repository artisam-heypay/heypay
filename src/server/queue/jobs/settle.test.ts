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

const escrow = vi.hoisted(() => ({
  deposit: vi.fn(),
  release: vi.fn(),
  refund: vi.fn(),
  getJob: vi.fn(),
  getFeeCharged: vi.fn(),
}));
vi.mock("@/server/stellar/escrow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/stellar/escrow")>()),
  escrowService: escrow,
}));

const { getDepositAddress, createPayout, getPayoutStatus, fastSettleEnabled } = vi.hoisted(() => ({
  getDepositAddress: vi.fn(),
  createPayout: vi.fn(),
  getPayoutStatus: vi.fn(),
  fastSettleEnabled: vi.fn(() => false),
}));
vi.mock("@/server/rails", () => ({
  fastSettleEnabled: () => fastSettleEnabled(),
  rail: {
    supportsAsset: () => true,
    getDepositAddress: (a: string) => getDepositAddress(a),
    createPayout: (i: unknown) => createPayout(i),
    getPayoutStatus: (r: string) => getPayoutStatus(r),
  },
}));

// enqueueSettle is a no-op in tests; we drive steps manually.
const { enqueueSettle } = vi.hoisted(() => ({
  enqueueSettle: vi.fn(async (_id: string, _opts?: { delayMs?: number }) => {}),
}));
vi.mock("@/server/queue/queues", () => ({
  QUEUE_NAMES: { settle: "settle", depositPoll: "deposit-poll", reconcile: "reconcile" },
  enqueueSettle,
}));

const TREASURY = "GHEYPAYTREASURYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const TREASURY_SECRET = "STREASURYSECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

import { processSettleJob } from "./settle";
import { escrowJobId, EscrowContractError, EscrowTxFailedError } from "@/server/stellar/escrow";
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
  fastSettleEnabled.mockReturnValue(false);
  process.env.HEYPAY_TREASURY_SECRET_ENC = encryptSecret(TREASURY_SECRET);
  return resetDb();
});
afterEach(() => {
  delete process.env.HEYPAY_TREASURY_SECRET_ENC;
  delete process.env.ESCROW_ENABLED;
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
    // No tight loop against Xendit: only a delayed re-check is scheduled.
    expect(enqueueSettle).toHaveBeenCalledOnce();
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id, { delayMs: 30_000 });

    // The Xendit webhook (or reconcile) nudges it once the payout succeeds.
    getPayoutStatus.mockResolvedValue({ state: "SETTLED", netPhp: dec("100") });
    await processSettleJob({ data: { paymentId: payment.id } });
    p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("SETTLED");
  });
});

describe("processSettleJob — fast settle (Xendit test key)", () => {
  const OUTCOME = "payment.fast_settle_outcome";

  /** Drives a payment to SETTLED while Xendit still reports the payout as accepted. */
  async function fastSettle() {
    fastSettleEnabled.mockReturnValue(true);
    sendAsset.mockResolvedValue({ txHash: `STELLARHASH-F${Math.random()}` });
    mockHappyRail();
    getPayoutStatus.mockResolvedValue({ state: "PENDING", railStatus: "ACCEPTED" });
    const { payment } = await makeAuthorized();
    const settled = await drive(payment.id);
    return { payment, settled };
  }

  it("settles as soon as Xendit accepts the payout, and schedules a check of the real result", async () => {
    const { payment, settled } = await fastSettle();

    expect(settled.status).toBe("SETTLED");
    expect(settled.netSettledPhp?.toFixed(2)).toBe("100.00");
    expect(settled.settledAt).not.toBeNull();
    const event = await db.paymentEvent.findFirstOrThrow({
      where: { paymentId: payment.id, toStatus: "SETTLED" },
    });
    expect(event.detail).toMatchObject({ fastSettle: true, railStatus: "ACCEPTED" });
    expect(enqueueSettle).toHaveBeenLastCalledWith(payment.id, { delayMs: 30_000 });
  });

  it("keeps checking while Xendit is still pending", async () => {
    const { payment } = await fastSettle();

    enqueueSettle.mockClear();
    await processSettleJob({ data: { paymentId: payment.id } });

    expect(enqueueSettle).toHaveBeenCalledOnce();
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id, { delayMs: 30_000 });
    expect(await db.auditLog.count({ where: { action: OUTCOME } })).toBe(0);
  });

  it("records Xendit's real answer once, however many nudges arrive", async () => {
    const { payment } = await fastSettle();

    getPayoutStatus.mockClear();
    getPayoutStatus.mockResolvedValue({
      state: "SETTLED",
      railStatus: "SUCCEEDED",
      netPhp: dec("100"),
    });
    await processSettleJob({ data: { paymentId: payment.id } }); // delayed check
    await processSettleJob({ data: { paymentId: payment.id } }); // Xendit webhook

    const outcomes = await db.auditLog.findMany({ where: { action: OUTCOME, target: payment.id } });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.metadata).toMatchObject({ railState: "SETTLED", railStatus: "SUCCEEDED" });
    expect(getPayoutStatus).toHaveBeenCalledOnce();
  });

  it("reports a payout that failed afterwards, without reopening or refunding the payment", async () => {
    const { payment } = await fastSettle();

    getPayoutStatus.mockResolvedValue({
      state: "FAILED",
      railStatus: "FAILED",
      failureCode: "REJECTED_BY_CHANNEL",
    });
    await processSettleJob({ data: { paymentId: payment.id } });

    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("SETTLED");
    const outcome = await db.auditLog.findFirstOrThrow({
      where: { action: OUTCOME, target: payment.id },
    });
    expect(outcome.metadata).toMatchObject({
      railState: "FAILED",
      failureCode: "REJECTED_BY_CHANNEL",
    });
    expect(sendAsset).toHaveBeenCalledOnce(); // the payment itself; no refund was sent
  });

  it("stops checking and reports a payout Xendit never finishes", async () => {
    const { payment } = await fastSettle();
    await db.paymentEvent.updateMany({
      where: { paymentId: payment.id, toStatus: "SETTLED" },
      data: { createdAt: new Date(Date.now() - 31 * 60_000) },
    });

    enqueueSettle.mockClear();
    await processSettleJob({ data: { paymentId: payment.id } });

    expect(enqueueSettle).not.toHaveBeenCalled();
    const outcome = await db.auditLog.findFirstOrThrow({
      where: { action: OUTCOME, target: payment.id },
    });
    expect(outcome.metadata).toMatchObject({ railState: "PENDING" });
  });

  it("never re-checks a payment that settled on Xendit's own confirmation", async () => {
    sendAsset.mockResolvedValue({ txHash: "STELLARHASH-N" });
    mockHappyRail();
    const { payment } = await makeAuthorized();
    await drive(payment.id);

    getPayoutStatus.mockClear();
    await processSettleJob({ data: { paymentId: payment.id } });

    expect(getPayoutStatus).not.toHaveBeenCalled();
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

  it("never sends a second refund while one is already being sent", async () => {
    const { payment } = await makeAuthorized();
    await db.payment.update({ where: { id: payment.id }, data: { status: "REFUND_PENDING" } });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    sendAsset.mockImplementation(async () => {
      await gate; // hold the first send open while the second job runs
      return { txHash: "REFUNDHASH-RACE" };
    });
    confirmTx.mockResolvedValue(true);

    const first = processSettleJob({ data: { paymentId: payment.id } });
    await vi.waitFor(() => expect(sendAsset).toHaveBeenCalledTimes(1));
    await processSettleJob({ data: { paymentId: payment.id } }); // the racing job
    release();
    await first;

    expect(sendAsset).toHaveBeenCalledTimes(1);
    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REFUNDED");
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

describe("processSettleJob — escrow off", () => {
  it("pays the treasury directly and never touches the escrow", async () => {
    sendAsset.mockResolvedValue({ txHash: "STELLARHASH-OFF" });
    mockHappyRail();

    const { payment } = await makeAuthorized();
    const final = await drive(payment.id);

    expect(final.status).toBe("SETTLED");
    expect(final.escrowJobId).toBeNull();
    expect(escrow.deposit).not.toHaveBeenCalled();
    expect(escrow.release).not.toHaveBeenCalled();
  });
});

describe("processSettleJob — escrow on (ESCROW_ENABLED)", () => {
  beforeEach(() => {
    process.env.ESCROW_ENABLED = "true";
    for (const fn of Object.values(escrow)) fn.mockReset();
    escrow.getFeeCharged.mockResolvedValue(null);
  });

  const held = (from: string, status = "Held") => ({
    from,
    amount: dec("8.3333434"),
    deadlineLedger: 100,
    status,
  });

  it("deposits into the escrow, releases it after the payout, and settles", async () => {
    escrow.deposit.mockResolvedValue({ txHash: "DEPOSITHASH1" });
    escrow.release.mockResolvedValue({ txHash: "RELEASEHASH1" });
    mockHappyRail();

    const { wallet, payment } = await makeAuthorized();
    const final = await drive(payment.id);

    expect(final.status).toBe("SETTLED");
    expect(final.escrowJobId).toBe(escrowJobId(payment.id).toString("hex"));
    expect(final.stellarTxHash).toBe("DEPOSITHASH1");
    expect(final.escrowReleaseTxHash).toBe("RELEASEHASH1");
    expect(sendAsset).not.toHaveBeenCalled(); // nothing goes straight to the treasury

    const dep = escrow.deposit.mock.calls[0]![0];
    expect(dep.jobId.equals(escrowJobId(payment.id))).toBe(true);
    expect(dep.encryptedSecret).toBe(wallet.encryptedSecret); // signed by the payer
    expect(dep.amount.toFixed(7)).toBe("8.3333434");
    expect(confirmTx).toHaveBeenCalledWith("DEPOSITHASH1");
    expect(escrow.release.mock.calls[0]![0].equals(escrowJobId(payment.id))).toBe(true);

    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.cachedXlmBalance.toFixed(7)).toBe("91.6666566");
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000");
  });

  it("debits the deposit's real Soroban fee from the payer's XLM, once", async () => {
    escrow.deposit.mockResolvedValue({ txHash: "DEPOSITHASH-FEE" });
    escrow.release.mockResolvedValue({ txHash: "RELEASEHASH-FEE" });
    escrow.getFeeCharged.mockResolvedValue(dec("0.1060597"));
    mockHappyRail();

    const { wallet, payment } = await makeAuthorized();
    const final = await drive(payment.id);
    // A rerun after settling must not debit the fee a second time.
    await processSettleJob({ data: { paymentId: payment.id } });

    expect(final.status).toBe("SETTLED");
    expect(escrow.getFeeCharged).toHaveBeenCalledTimes(1);
    expect(escrow.getFeeCharged).toHaveBeenCalledWith("DEPOSITHASH-FEE");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    // 100 - 8.3333434 (amount + base fee) - 0.1060597 (Soroban fee)
    expect(w.cachedXlmBalance.toFixed(7)).toBe("91.5605969");
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000");
    const fees = await db.walletTransaction.findMany({
      where: { paymentId: payment.id, memo: { endsWith: "escrow network fee" } },
    });
    expect(fees).toHaveLength(1);
    expect(fees[0]!.amount.toFixed(7)).toBe("-0.1060597");
    expect(fees[0]!.stellarTxHash).toBeNull();
  });

  it("still settles when the deposit's fee cannot be read", async () => {
    escrow.deposit.mockResolvedValue({ txHash: "DEPOSITHASH-NOFEE" });
    escrow.release.mockResolvedValue({ txHash: "RELEASEHASH-NOFEE" });
    escrow.getFeeCharged.mockRejectedValue(new Error("rpc down"));
    mockHappyRail();

    const { wallet, payment } = await makeAuthorized();
    const final = await drive(payment.id);

    // The crypto is in the escrow, so the payment must not fail over the fee.
    expect(final.status).toBe("SETTLED");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.cachedXlmBalance.toFixed(7)).toBe("91.6666566");
  });

  it("keeps USDC on the direct treasury path (escrow is XLM only in D1)", async () => {
    sendAsset.mockResolvedValue({ txHash: "USDCHASH-E" });
    mockHappyRail();

    const { payment } = await makeAuthorizedUsdc();
    const final = await drive(payment.id);

    expect(final.status).toBe("SETTLED");
    expect(final.escrowJobId).toBeNull();
    expect(escrow.deposit).not.toHaveBeenCalled();
    expect(sendAsset.mock.calls[0]![0].asset).toBe("USDC");
  });

  it("FAILs and releases the reservation when the contract rejects the deposit", async () => {
    escrow.deposit.mockRejectedValue(new EscrowContractError("deposit", "InvalidAmount"));

    const { wallet, payment } = await makeAuthorized();
    const final = await drive(payment.id);

    expect(final.status).toBe("FAILED");
    expect(final.failureReason).toMatch(/InvalidAmount/);
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000");
    expect(createPayout).not.toHaveBeenCalled();
  });

  it("lets the confirm step decide a deposit that was sent but not seen landing", async () => {
    escrow.deposit.mockRejectedValue(new EscrowTxFailedError("deposit", "SLOWHASH", "NOT_FOUND"));
    escrow.release.mockResolvedValue({ txHash: "RELEASEHASH-S" });
    mockHappyRail();

    const { payment } = await makeAuthorized();
    const final = await drive(payment.id);

    expect(final.status).toBe("SETTLED");
    expect(final.stellarTxHash).toBe("SLOWHASH");
    expect(confirmTx).toHaveBeenCalledWith("SLOWHASH");
  });

  it("does not deposit twice when a rerun finds the job already held", async () => {
    escrow.deposit.mockRejectedValue(new EscrowContractError("deposit", "JobExists"));
    escrow.release.mockResolvedValue({ txHash: "RELEASEHASH-R" });
    mockHappyRail();

    const { wallet, payment } = await makeAuthorized();
    escrow.getJob.mockResolvedValue(held(wallet.stellarPublicKey));
    await db.payment.update({
      where: { id: payment.id },
      data: { escrowJobId: escrowJobId(payment.id).toString("hex") },
    });
    const final = await drive(payment.id);

    expect(final.status).toBe("SETTLED");
    expect(final.stellarTxHash).toBeNull(); // hash lost; the contract's job proved it
    expect(confirmTx).not.toHaveBeenCalledWith(null);
    const debits = await db.walletTransaction.count({
      where: { walletId: wallet.id, type: "PAYMENT_DEBIT" },
    });
    expect(debits).toBe(1);
  });

  it("stays PAYOUT_SUBMITTED and re-checks — never refunds — when the release fails", async () => {
    escrow.deposit.mockResolvedValue({ txHash: "DEPOSITHASH-F" });
    escrow.release.mockRejectedValueOnce(new Error("soroban rpc unavailable"));
    mockHappyRail();

    const { payment } = await makeAuthorized();
    let p = await drive(payment.id);
    expect(p.status).toBe("PAYOUT_SUBMITTED");
    expect(escrow.refund).not.toHaveBeenCalled();
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id, { delayMs: 30_000 });

    escrow.release.mockResolvedValue({ txHash: "RELEASEHASH-F" });
    await processSettleJob({ data: { paymentId: payment.id } });
    p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("SETTLED");
    expect(p.escrowReleaseTxHash).toBe("RELEASEHASH-F");
  });

  it("treats NotHeld on a release rerun as done when the job is already released", async () => {
    escrow.deposit.mockResolvedValue({ txHash: "DEPOSITHASH-N" });
    escrow.release.mockRejectedValue(new EscrowContractError("release", "NotHeld"));
    mockHappyRail();

    const { wallet, payment } = await makeAuthorized();
    escrow.getJob.mockResolvedValue(held(wallet.stellarPublicKey, "Released"));
    const final = await drive(payment.id);

    expect(final.status).toBe("SETTLED");
    expect(final.escrowReleaseTxHash).toBeNull();
  });

  it("refunds through the contract when the payout fails, and credits the payer once", async () => {
    escrow.deposit.mockResolvedValue({ txHash: "DEPOSITHASH-X" });
    escrow.refund.mockResolvedValue({ txHash: "ESCROWREFUND-X" });
    mockHappyRail();
    getPayoutStatus.mockResolvedValue({ state: "FAILED", failureCode: "INVALID_DESTINATION" });

    const { wallet, payment } = await makeAuthorized();
    const final = await drive(payment.id);

    expect(final.status).toBe("REFUNDED");
    expect(final.refundTxHash).toBe("ESCROWREFUND-X");
    expect(escrow.refund.mock.calls[0]![0].equals(escrowJobId(payment.id))).toBe(true);
    expect(escrow.release).not.toHaveBeenCalled();
    expect(sendAsset).not.toHaveBeenCalled(); // not from the treasury

    const credits = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "REFUND_CREDIT" },
    });
    expect(credits).toHaveLength(1);
    expect(credits[0]!.amount.toFixed(7)).toBe("8.3333434");
    expect(credits[0]!.stellarTxHash).toBe("ESCROWREFUND-X");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.cachedXlmBalance.toFixed(7)).toBe("100.0000000");
  });

  it("treats NotHeld on a refund rerun as done, without crediting twice", async () => {
    const { wallet, payment } = await makeAuthorized();
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: "REFUND_PENDING",
        escrowJobId: escrowJobId(payment.id).toString("hex"),
        // a crashed attempt, long expired
        refundSubmittedAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    escrow.refund.mockRejectedValue(new EscrowContractError("refund", "NotHeld"));
    escrow.getJob.mockResolvedValue(held(wallet.stellarPublicKey, "Refunded"));

    await processSettleJob({ data: { paymentId: payment.id } });
    await processSettleJob({ data: { paymentId: payment.id } }); // terminal: no-op

    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REFUNDED");
    expect(
      await db.walletTransaction.count({ where: { walletId: wallet.id, type: "REFUND_CREDIT" } }),
    ).toBe(1);
  });

  it("stays REFUND_PENDING when the job was released instead of refunded", async () => {
    const { wallet, payment } = await makeAuthorized();
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "REFUND_PENDING", escrowJobId: escrowJobId(payment.id).toString("hex") },
    });
    escrow.refund.mockRejectedValue(new EscrowContractError("refund", "NotHeld"));
    escrow.getJob.mockResolvedValue(held(wallet.stellarPublicKey, "Released"));

    await processSettleJob({ data: { paymentId: payment.id } });

    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REFUND_PENDING");
    expect(p.failureReason).toMatch(/NotHeld/);
    expect(await db.walletTransaction.count({ where: { type: "REFUND_CREDIT" } })).toBe(0);
  });

  it("does not start a second escrow refund while one is in flight", async () => {
    const { payment } = await makeAuthorized();
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: "REFUND_PENDING",
        escrowJobId: escrowJobId(payment.id).toString("hex"),
        refundSubmittedAt: new Date(), // claimed moments ago by another job
      },
    });

    await processSettleJob({ data: { paymentId: payment.id } });

    expect(escrow.refund).not.toHaveBeenCalled();
    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REFUND_PENDING");
  });

  it("clears the claim when the contract rejects the refund, so a retry can run", async () => {
    const { payment } = await makeAuthorized();
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "REFUND_PENDING", escrowJobId: escrowJobId(payment.id).toString("hex") },
    });
    escrow.refund
      .mockRejectedValueOnce(new EscrowContractError("refund", "NotInitialized"))
      .mockResolvedValueOnce({ txHash: "ESCROWREFUND-RETRY" });

    await processSettleJob({ data: { paymentId: payment.id } });
    let p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REFUND_PENDING");
    expect(p.refundSubmittedAt).toBeNull();

    await processSettleJob({ data: { paymentId: payment.id } });
    p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REFUNDED");
    expect(p.refundTxHash).toBe("ESCROWREFUND-RETRY");
  });

  it("stays REFUND_PENDING without claiming when the admin key is missing", async () => {
    delete process.env.HEYPAY_TREASURY_SECRET_ENC;
    const { payment } = await makeAuthorized();
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "REFUND_PENDING", escrowJobId: escrowJobId(payment.id).toString("hex") },
    });

    await processSettleJob({ data: { paymentId: payment.id } });

    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REFUND_PENDING");
    expect(p.refundSubmittedAt).toBeNull();
    expect(escrow.refund).not.toHaveBeenCalled();
  });

  it("follows the escrow for a payment deposited before the flag was turned off", async () => {
    escrow.refund.mockResolvedValue({ txHash: "ESCROWREFUND-OFF" });
    const { payment } = await makeAuthorized();
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "REFUND_PENDING", escrowJobId: escrowJobId(payment.id).toString("hex") },
    });
    delete process.env.ESCROW_ENABLED;

    await processSettleJob({ data: { paymentId: payment.id } });

    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REFUNDED");
    expect(sendAsset).not.toHaveBeenCalled();
  });
});
