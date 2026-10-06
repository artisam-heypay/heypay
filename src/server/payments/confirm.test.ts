import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { newPaymentReference } from "./reference";

const enqueueSettle = vi.fn(async (_id: string) => {});
vi.mock("@/server/queue/queues", () => ({
  QUEUE_NAMES: { settle: "settle", depositPoll: "deposit-poll", reconcile: "reconcile" },
  enqueueSettle: (id: string) => enqueueSettle(id),
}));

import { confirmPayment } from "./confirm";

/** A quoted USDC payment of 1.6039 USDC, with the payer's balances as given. */
async function makeQuotedUsdc(balances: { cachedXlm: string; cachedUsdc: string }) {
  const { user, wallet } = await makePayer({
    cachedXlm: balances.cachedXlm,
    assets: { USDC: { cached: balances.cachedUsdc } },
  });
  const { merchant } = await makeMerchant();
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
      status: "QUOTED",
      quoteExpiresAt: new Date(Date.now() + 90_000),
    },
  });
  return { user, wallet, payment };
}

async function makeQuoted(opts?: { cachedXlm?: string; expiresInMs?: number }) {
  const { user, wallet } = await makePayer({ cachedXlm: opts?.cachedXlm ?? "100.0000000" });
  const { merchant } = await makeMerchant();
  const payment = await db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: "100.00",
      quotedRate: "12.00000000",
      amountAsset: "8.3333334",
      networkFeeXlm: "0.0000100",
      status: "QUOTED",
      quoteExpiresAt: new Date(Date.now() + (opts?.expiresInMs ?? 90_000)),
    },
  });
  return { user, wallet, payment };
}

describe("confirmPayment", () => {
  beforeEach(async () => {
    await resetDb();
    enqueueSettle.mockClear();
  });
  afterEach(() => {
    delete process.env.ESCROW_ENABLED;
  });

  it("reserves funds, sets AUTHORIZED, enqueues settlement", async () => {
    const { user, wallet, payment } = await makeQuoted();
    const res = await confirmPayment({
      paymentId: payment.id,
      payerId: user.id,
      idemKey: randomUUID(),
    });
    expect(res).toEqual({ paymentId: payment.id, status: "AUTHORIZED" });

    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("8.3333434"); // 8.3333334 + 0.0000100
    expect(
      await db.paymentEvent.count({ where: { paymentId: payment.id, toStatus: "AUTHORIZED" } }),
    ).toBe(1);
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
  });

  it("rejects an expired quote with conflict (409) and reserves nothing", async () => {
    const { user, wallet, payment } = await makeQuoted({ expiresInMs: -1000 });
    await expect(
      confirmPayment({ paymentId: payment.id, payerId: user.id, idemKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000");
    expect(enqueueSettle).not.toHaveBeenCalled();
  });

  it("is idempotent on double-confirm with the same Idempotency-Key (reserves once)", async () => {
    const { user, wallet, payment } = await makeQuoted();
    const key = randomUUID();
    const a = await confirmPayment({ paymentId: payment.id, payerId: user.id, idemKey: key });
    const b = await confirmPayment({ paymentId: payment.id, payerId: user.id, idemKey: key });
    expect(a).toEqual(b);
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("8.3333434"); // reserved exactly once
    expect(enqueueSettle).toHaveBeenCalledTimes(1);
  });

  it("rejects confirming another user's payment with forbidden (403)", async () => {
    const { payment } = await makeQuoted();
    const { user: stranger } = await makePayer();
    await expect(
      confirmPayment({ paymentId: payment.id, payerId: stranger.id, idemKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("holds a USDT payment against USDT, and only the fee against XLM", async () => {
    const { user, wallet } = await makePayer({
      cachedXlm: "10.0000000",
      assets: { USDT: { cached: "50.0000000" } },
    });
    const { merchant } = await makeMerchant();
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
        status: "QUOTED",
        quoteExpiresAt: new Date(Date.now() + 90_000),
      },
    });

    await confirmPayment({ paymentId: payment.id, payerId: user.id, idemKey: randomUUID() });

    const usdt = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDT" } },
    });
    expect(usdt.reserved.toFixed(7)).toBe("1.7241380");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    // Only the Stellar fee is held in XLM — not the payment amount.
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000100");
  });

  it("rejects a USDT payment when the USDT balance is short, leaving no holds", async () => {
    const { user, wallet } = await makePayer({
      cachedXlm: "10.0000000",
      assets: { USDT: { cached: "1.0000000" } },
    });
    const { merchant } = await makeMerchant();
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
        status: "QUOTED",
        quoteExpiresAt: new Date(Date.now() + 90_000),
      },
    });

    await expect(
      confirmPayment({ paymentId: payment.id, payerId: user.id, idemKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });

    const usdt = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDT" } },
    });
    expect(usdt.reserved.toFixed(7)).toBe("0.0000000");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000");
  });
  it("checks an escrowed USDC payment's escrow fee against XLM, not USDC", async () => {
    process.env.ESCROW_ENABLED = "true";
    // Just enough USDC for the amount; the 0.2 XLM fee estimate must not count against it.
    const { user, wallet, payment } = await makeQuotedUsdc({
      cachedXlm: "10.0000000",
      cachedUsdc: "1.7000000",
    });

    const res = await confirmPayment({
      paymentId: payment.id,
      payerId: user.id,
      idemKey: randomUUID(),
    });

    expect(res.status).toBe("AUTHORIZED");
    const usdc = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDC" } },
    });
    expect(usdc.reserved.toFixed(7)).toBe("1.6039000");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    // The escrow fee is checked, not held: its real size is debited when the deposit lands.
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000100");
  });

  it("rejects an escrowed USDC payment when XLM cannot cover the escrow fee, leaving no holds", async () => {
    process.env.ESCROW_ENABLED = "true";
    const { user, wallet, payment } = await makeQuotedUsdc({
      cachedXlm: "0.1000000",
      cachedUsdc: "50.0000000",
    });

    await expect(
      confirmPayment({ paymentId: payment.id, payerId: user.id, idemKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });

    const usdc = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDC" } },
    });
    expect(usdc.reserved.toFixed(7)).toBe("0.0000000");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000");
    expect(enqueueSettle).not.toHaveBeenCalled();
  });
  it("insufficient balance: refuses a USDC payment with a reason and a next step", async () => {
    const { user, wallet, payment } = await makeQuotedUsdc({
      cachedXlm: "10.0000000",
      cachedUsdc: "1.0000000",
    });

    await expect(
      confirmPayment({ paymentId: payment.id, payerId: user.id, idemKey: randomUUID() }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Not enough USDC — add more or pay with XLM.",
      details: {
        reason: "insufficient_balance",
        asset: "USDC",
        payWith: "XLM",
        available: "1.0000000",
        required: "1.6039000",
      },
    });

    const usdc = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDC" } },
    });
    expect(usdc.cached.toFixed(7)).toBe("1.0000000");
    expect(usdc.reserved.toFixed(7)).toBe("0.0000000");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000");
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      "QUOTED",
    );
    expect(await db.walletTransaction.count()).toBe(0);
    expect(enqueueSettle).not.toHaveBeenCalled();
  });

  it("insufficient balance: names the network fee when only XLM is short", async () => {
    const { user, wallet, payment } = await makeQuotedUsdc({
      cachedXlm: "0.0000000",
      cachedUsdc: "50.0000000",
    });

    await expect(
      confirmPayment({ paymentId: payment.id, payerId: user.id, idemKey: randomUUID() }),
    ).rejects.toMatchObject({
      status: 409,
      details: { reason: "insufficient_fee", asset: "USDC", requiredXlm: "0.0000100" },
    });

    // The USDC hold taken just before the fee check is rolled back with it.
    const usdc = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDC" } },
    });
    expect(usdc.reserved.toFixed(7)).toBe("0.0000000");
    expect(enqueueSettle).not.toHaveBeenCalled();
  });

  it("missing trustline: a wallet that cannot hold USDC is told to turn it on", async () => {
    const { user, wallet } = await makePayer({
      cachedXlm: "10.0000000",
      assets: { USDC: { cached: "0.0000000", trustline: false } },
    });
    const { merchant } = await makeMerchant();
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
        status: "QUOTED",
        quoteExpiresAt: new Date(Date.now() + 90_000),
      },
    });

    await expect(
      confirmPayment({ paymentId: payment.id, payerId: user.id, idemKey: randomUUID() }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Turn on USDC first.",
      details: { reason: "payer_no_trustline", asset: "USDC" },
    });

    const usdc = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDC" } },
    });
    expect(usdc.reserved.toFixed(7)).toBe("0.0000000");
    expect(enqueueSettle).not.toHaveBeenCalled();
  });
});
