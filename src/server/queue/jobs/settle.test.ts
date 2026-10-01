import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { newPaymentReference } from "@/server/payments/reference";

// ---- mock externals ----
const { sendAsset, sendAssetViaPath, confirmTx, findConversionRoute } = vi.hoisted(() => ({
  sendAsset: vi.fn(),
  sendAssetViaPath: vi.fn(),
  confirmTx: vi.fn(),
  findConversionRoute: vi.fn(),
}));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: {
    sendAsset: (i: unknown) => sendAsset(i),
    sendAssetViaPath: (i: unknown) => sendAssetViaPath(i),
    confirmTx: (h: string) => confirmTx(h),
  },
}));
vi.mock("@/server/stellar/paths", () => ({
  findConversionRoute: (f: string, t: string, d: unknown) => findConversionRoute(f, t, d),
}));

const { getDepositAddress, sellCryptoForPhp, getTradeStatus, cashOutPhpToBank, getPayoutStatus } =
  vi.hoisted(() => ({
    getDepositAddress: vi.fn(),
    sellCryptoForPhp: vi.fn(),
    getTradeStatus: vi.fn(),
    cashOutPhpToBank: vi.fn(),
    getPayoutStatus: vi.fn(),
  }));
vi.mock("@/server/rails", () => ({
  rail: {
    supportsAsset: () => true,
    getDepositAddress: (a: string) => getDepositAddress(a),
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

const XLM_DEPOSIT = "GHEYPAYDEPOSITADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const USDT_DEPOSIT = "GHEYPAYUSDTDEPOSITADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

import { processSettleJob } from "./settle";
import { isTerminal } from "@/server/payments/state-machine";

async function makeAuthorized() {
  // reservedXlm already includes amountAsset + fee, set at confirm time.
  const { user, wallet } = await makePayer({ cachedXlm: "100.0000000", reservedXlm: "8.3333434" });
  const { merchant } = await makeMerchant({ accountNumber: "9988776655" });
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

/** USDT-funded payment: the USDT leg is held on WalletBalance, the fee on XLM. */
async function makeAuthorizedUsdt() {
  const { user, wallet } = await makePayer({
    cachedXlm: "10.0000000",
    reservedXlm: "0.0000100",
    assets: { USDT: { cached: "50.0000000", reserved: "1.7241380" } },
  });
  const { merchant } = await makeMerchant({ accountNumber: "9988776655" });
  const payment = await db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: user.id,
      merchantId: merchant.id,
      asset: "USDT",
      amountPhp: "100.00",
      quotedRate: "58.00000000",
      amountAsset: "1.7241380",
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
  getDepositAddress.mockImplementation(async (asset: string) => ({
    address: asset === "XLM" ? XLM_DEPOSIT : USDT_DEPOSIT,
    memo: null,
  }));
  sellCryptoForPhp.mockResolvedValue({ tradeRef: "TRADE1" });
  getTradeStatus.mockResolvedValue({ state: "FILLED", feePhp: dec("2"), filledPhp: dec("100") });
  cashOutPhpToBank.mockResolvedValue({ payoutRef: "PAYOUT1" });
  getPayoutStatus.mockResolvedValue({ state: "SETTLED", netPhp: dec("98") });
}

describe("processSettleJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    return resetDb();
  });

  it("drives AUTHORIZED → SETTLED with exactly one PAYMENT_DEBIT", async () => {
    sendAsset.mockResolvedValue({ txHash: "STELLARHASH1" });
    mockHappyRail();

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
    expect(sendAsset.mock.calls[0]![0].asset).toBe("XLM");

    const debits = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "PAYMENT_DEBIT" },
    });
    expect(debits).toHaveLength(1);
    expect(debits[0]!.amount.toFixed(7)).toBe("-8.3333434");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000"); // reservation released
    expect(w.cachedXlmBalance.toFixed(7)).toBe("91.6666566"); // 100 - 8.3333434
  });

  it("forced Stellar-confirm failure → FAILED, reservation released, no debit (no double-debit)", async () => {
    sendAsset.mockResolvedValue({ txHash: "STELLARHASH2" });
    getDepositAddress.mockResolvedValue({ address: XLM_DEPOSIT, memo: null });
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
    sendAsset.mockResolvedValue({ txHash: "STELLARHASH3" });
    getDepositAddress.mockResolvedValue({ address: XLM_DEPOSIT, memo: null });
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
    expect(credits[0]!.amount.toFixed(7)).toBe("8.3333434");
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

describe("processSettleJob (USDT)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    return resetDb();
  });

  it("sends USDT to the USDT deposit address and sells USDT, not XLM", async () => {
    sendAsset.mockResolvedValue({ txHash: "USDTHASH1" });
    mockHappyRail();

    const { payment } = await makeAuthorizedUsdt();
    const final = await drive(payment.id);

    expect(final.status).toBe("SETTLED");
    const sent = sendAsset.mock.calls[0]![0];
    expect(sent.asset).toBe("USDT");
    expect(sent.destination).toBe(USDT_DEPOSIT);
    // Only the merchant's crypto is sold; the XLM fee never reached the rail.
    expect(sent.amount.toFixed(7)).toBe("1.7241380");
    expect(sellCryptoForPhp.mock.calls[0]![0]).toMatchObject({ asset: "USDT" });
    expect(sellCryptoForPhp.mock.calls[0]![0].amount.toFixed(7)).toBe("1.7241380");
  });

  it("sends the rail's address tag as the memo, overriding the payment reference", async () => {
    // PDAX credits shared deposit addresses by tag. Sending our own reference
    // instead would strand the deposit.
    sendAsset.mockResolvedValue({ txHash: "USDTHASH-TAG" });
    mockHappyRail();
    getDepositAddress.mockResolvedValue({ address: USDT_DEPOSIT, memo: "123123123" });

    const { payment } = await makeAuthorizedUsdt();
    await drive(payment.id);

    expect(sendAsset.mock.calls[0]![0].memo).toBe("123123123");
    expect(sendAsset.mock.calls[0]![0].memo).not.toBe(payment.reference);
  });

  it("falls back to the payment reference when the rail gives no tag", async () => {
    sendAsset.mockResolvedValue({ txHash: "USDTHASH-NOTAG" });
    mockHappyRail();

    const { payment } = await makeAuthorizedUsdt();
    await drive(payment.id);

    expect(sendAsset.mock.calls[0]![0].memo).toBe(payment.reference);
  });

  it("debits USDT from the USDT balance and the network fee from XLM", async () => {
    sendAsset.mockResolvedValue({ txHash: "USDTHASH2" });
    mockHappyRail();

    const { wallet, payment } = await makeAuthorizedUsdt();
    await drive(payment.id);

    const debits = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "PAYMENT_DEBIT" },
      orderBy: { createdAt: "asc" },
    });
    expect(debits).toHaveLength(2);
    const usdt = debits.find((d) => d.asset === "USDT")!;
    const xlmFee = debits.find((d) => d.asset === "XLM")!;
    expect(usdt.amount.toFixed(7)).toBe("-1.7241380");
    expect(usdt.stellarTxHash).toBe("USDTHASH2");
    expect(xlmFee.amount.toFixed(7)).toBe("-0.0000100");
    // stellarTxHash is @unique, so the fee entry cannot carry the same hash.
    expect(xlmFee.stellarTxHash).toBeNull();

    const usdtBalance = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDT" } },
    });
    expect(usdtBalance.cached.toFixed(7)).toBe("48.2758620"); // 50 - 1.724138
    expect(usdtBalance.reserved.toFixed(7)).toBe("0.0000000");

    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.cachedXlmBalance.toFixed(7)).toBe("9.9999900"); // 10 - fee
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000");
  });

  it("refunds USDT — not XLM — and does not return the spent network fee", async () => {
    sendAsset.mockResolvedValue({ txHash: "USDTHASH3" });
    getDepositAddress.mockResolvedValue({ address: USDT_DEPOSIT, memo: null });
    confirmTx.mockResolvedValue(true);
    sellCryptoForPhp.mockResolvedValue({ tradeRef: "TRADE-U" });
    getTradeStatus.mockResolvedValue({ state: "FAILED" });

    const { wallet, payment } = await makeAuthorizedUsdt();
    const final = await drive(payment.id);

    expect(final.status).toBe("REFUNDED");
    const credits = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "REFUND_CREDIT" },
    });
    expect(credits).toHaveLength(1);
    expect(credits[0]!.asset).toBe("USDT");
    expect(credits[0]!.amount.toFixed(7)).toBe("1.7241380");

    const usdtBalance = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDT" } },
    });
    expect(usdtBalance.cached.toFixed(7)).toBe("50.0000000"); // debited then refunded
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.cachedXlmBalance.toFixed(7)).toBe("9.9999900"); // fee stays spent
  });

  it("releases both holds when the Stellar tx never lands", async () => {
    sendAsset.mockResolvedValue({ txHash: "USDTHASH4" });
    getDepositAddress.mockResolvedValue({ address: USDT_DEPOSIT, memo: null });
    confirmTx.mockResolvedValue(false);

    const { wallet, payment } = await makeAuthorizedUsdt();
    const final = await drive(payment.id);

    expect(final.status).toBe("FAILED");
    const usdtBalance = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDT" } },
    });
    expect(usdtBalance.reserved.toFixed(7)).toBe("0.0000000");
    expect(usdtBalance.cached.toFixed(7)).toBe("50.0000000");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000");
  });
});

/** USDC funded, but the rail only takes XLM: the payment converts on the way in. */
async function makeAuthorizedConverting() {
  const { user, wallet } = await makePayer({
    cachedXlm: "10.0000000",
    reservedXlm: "0.0000100",
    assets: { USDC: { cached: "50.0000000", reserved: "17.1700000" } },
  });
  const { merchant } = await makeMerchant({ accountNumber: "9988776655" });
  const payment = await db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: user.id,
      merchantId: merchant.id,
      asset: "USDC",
      amountPhp: "1000.00",
      quotedRate: "58.24000000",
      amountAsset: "17.1700000",
      settlementAsset: "XLM",
      settlementAmount: "83.3333334",
      networkFeeXlm: "0.0000100",
      status: "AUTHORIZED",
    },
  });
  return { user, wallet, merchant, payment };
}

describe("processSettleJob (converting on the DEX)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    return resetDb();
  });

  it("path-pays USDC to the rail's XLM wallet and sells XLM, not USDC", async () => {
    mockHappyRail();
    getDepositAddress.mockResolvedValue({ address: XLM_DEPOSIT, memo: null });
    findConversionRoute.mockResolvedValue({ sourceAmount: dec("17"), path: [] });
    sendAssetViaPath.mockResolvedValue({ txHash: "PATHHASH1" });

    const { payment } = await makeAuthorizedConverting();
    const final = await drive(payment.id);

    expect(final.status).toBe("SETTLED");
    // Sent to the XLM deposit wallet — the one that exists — not a USDC one.
    expect(getDepositAddress).toHaveBeenCalledWith("XLM");
    expect(sendAsset).not.toHaveBeenCalled();

    const sent = sendAssetViaPath.mock.calls[0]![0];
    expect(sent.asset).toBe("USDC");
    expect(sent.destAsset).toBe("XLM");
    expect(sent.destination).toBe(XLM_DEPOSIT);
    // Exact debit of the payer's asset...
    expect(sent.amount.toFixed(7)).toBe("17.1700000");
    // ...and the rail must receive at least what covers the merchant, or the
    // transaction fails on-chain rather than short-changing them.
    expect(sent.destMin.toFixed(7)).toBe("83.3333334");

    // The rail sells the XLM it received.
    expect(sellCryptoForPhp.mock.calls[0]![0]).toMatchObject({ asset: "XLM" });
    expect(sellCryptoForPhp.mock.calls[0]![0].amount.toFixed(7)).toBe("83.3333334");
  });

  it("debits the payer in USDC — the asset they funded with", async () => {
    mockHappyRail();
    getDepositAddress.mockResolvedValue({ address: XLM_DEPOSIT, memo: null });
    findConversionRoute.mockResolvedValue({ sourceAmount: dec("17"), path: [] });
    sendAssetViaPath.mockResolvedValue({ txHash: "PATHHASH2" });

    const { wallet, payment } = await makeAuthorizedConverting();
    await drive(payment.id);

    const debits = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "PAYMENT_DEBIT" },
    });
    const usdc = debits.find((d) => d.asset === "USDC")!;
    expect(usdc.amount.toFixed(7)).toBe("-17.1700000");
    const balance = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDC" } },
    });
    expect(balance.cached.toFixed(7)).toBe("32.8300000"); // 50 - 17.17
  });

  it("fails without moving funds when the DEX route vanishes before submission", async () => {
    // The book can empty between quote and submit; refuse rather than submit a
    // transaction that would be rejected on-chain.
    confirmTx.mockResolvedValue(true);
    getDepositAddress.mockResolvedValue({ address: XLM_DEPOSIT, memo: null });
    findConversionRoute.mockResolvedValue(null);

    const { wallet, payment } = await makeAuthorizedConverting();
    const final = await drive(payment.id);

    expect(final.status).toBe("FAILED");
    expect(final.failureReason).toMatch(/No Stellar DEX route/);
    expect(sendAssetViaPath).not.toHaveBeenCalled();
    // Holds released, nothing debited.
    const balance = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDC" } },
    });
    expect(balance.reserved.toFixed(7)).toBe("0.0000000");
    expect(balance.cached.toFixed(7)).toBe("50.0000000");
  });
});
