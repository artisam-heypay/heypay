import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { newPaymentReference } from "@/server/payments/reference";

// ---- mock externals ----
const { sendXlm, confirmTx } = vi.hoisted(() => ({ sendXlm: vi.fn(), confirmTx: vi.fn() }));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: {
    sendXlm: (i: unknown) => sendXlm(i),
    confirmTx: (h: string) => confirmTx(h),
  },
}));

const { sellCryptoForPhp, getTradeStatus, cashOutPhpToBank, getPayoutStatus } = vi.hoisted(() => ({
  sellCryptoForPhp: vi.fn(),
  getTradeStatus: vi.fn(),
  cashOutPhpToBank: vi.fn(),
  getPayoutStatus: vi.fn(),
}));
vi.mock("@/server/rails", () => ({
  rail: {
    sellCryptoForPhp: (i: unknown) => sellCryptoForPhp(i),
    getTradeStatus: (r: string) => getTradeStatus(r),
    cashOutPhpToBank: (i: unknown) => cashOutPhpToBank(i),
    getPayoutStatus: (r: string) => getPayoutStatus(r),
  },
}));

// enqueueSettle is a no-op in tests; we drive steps manually.
vi.mock("@/server/queue/queues", () => ({
  QUEUE_NAMES: { settle: "settle", depositPoll: "deposit-poll", reconcile: "reconcile" },
  enqueueSettle: vi.fn(async () => {}),
}));

process.env.PDAX_XLM_DEPOSIT_ADDRESS = "GHEYPAYDEPOSITADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

import { processSettleJob } from "./settle";
import { isTerminal } from "@/server/payments/state-machine";

async function makeAuthorized() {
  // reservedXlm already includes amountXlm + fee, set at confirm time.
  const { user, wallet } = await makePayer({ cachedXlm: "100.0000000", reservedXlm: "8.3333434" });
  const { merchant } = await makeMerchant({ accountNumber: "9988776655" });
  const payment = await db.payment.create({
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

describe("processSettleJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    return resetDb();
  });

  it("drives AUTHORIZED → SETTLED with exactly one PAYMENT_DEBIT", async () => {
    sendXlm.mockResolvedValue({ txHash: "STELLARHASH1" });
    confirmTx.mockResolvedValue(true);
    sellCryptoForPhp.mockResolvedValue({ tradeRef: "TRADE1" });
    getTradeStatus.mockResolvedValue({ state: "FILLED", feePhp: dec("2"), filledPhp: dec("100") });
    cashOutPhpToBank.mockResolvedValue({ payoutRef: "PAYOUT1" });
    getPayoutStatus.mockResolvedValue({ state: "SETTLED", netPhp: dec("98") });

    const { wallet, payment } = await makeAuthorized();
    const final = await drive(payment.id);

    expect(final.status).toBe("SETTLED");
    expect(final.stellarTxHash).toBe("STELLARHASH1");
    expect(final.pdaxTradeRef).toBe("TRADE1");
    expect(final.pdaxCashoutRef).toBe("PAYOUT1");
    expect(final.netSettledPhp?.toFixed(2)).toBe("98.00");
    expect(final.settledAt).not.toBeNull();
    // bank account decrypted to plaintext for the rail call
    expect(cashOutPhpToBank.mock.calls[0]![0].bank.accountNumber).toBe("9988776655");

    const debits = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "PAYMENT_DEBIT" },
    });
    expect(debits).toHaveLength(1);
    expect(debits[0]!.amountXlm.toFixed(7)).toBe("-8.3333434");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000"); // reservation released
    expect(w.cachedXlmBalance.toFixed(7)).toBe("91.6666566"); // 100 - 8.3333434
  });

  it("forced Stellar-confirm failure → FAILED, reservation released, no debit (no double-debit)", async () => {
    sendXlm.mockResolvedValue({ txHash: "STELLARHASH2" });
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
    expect(sellCryptoForPhp).not.toHaveBeenCalled();
  });

  it("forced post-Stellar (trade) failure → REFUND_PENDING → REFUNDED with one debit + one credit", async () => {
    sendXlm.mockResolvedValue({ txHash: "STELLARHASH3" });
    confirmTx.mockResolvedValue(true);
    sellCryptoForPhp.mockResolvedValue({ tradeRef: "TRADE3" });
    getTradeStatus.mockResolvedValue({ state: "FAILED" }); // trade rejected after XLM moved

    const { wallet, payment } = await makeAuthorized();
    const final = await drive(payment.id);

    expect(final.status).toBe("REFUNDED");
    const debits = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "PAYMENT_DEBIT" },
    });
    const credits = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "REFUND_CREDIT" },
    });
    expect(debits).toHaveLength(1);
    expect(credits).toHaveLength(1);
    expect(credits[0]!.amountXlm.toFixed(7)).toBe("8.3333434");
    // admin alerted
    expect(await db.auditLog.count({ where: { action: "payment.refunded" } })).toBe(1);
    // event trail includes REFUND_PENDING then REFUNDED
    const evs = await db.paymentEvent.findMany({
      where: { paymentId: payment.id },
      orderBy: { createdAt: "asc" },
    });
    const toStatuses = evs.map((e) => e.toStatus);
    expect(toStatuses).toContain("REFUND_PENDING");
    expect(toStatuses).toContain("REFUNDED");
  });
});
