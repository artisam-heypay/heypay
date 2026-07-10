import { describe, it, expect, beforeEach, vi } from "vitest";
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
});
