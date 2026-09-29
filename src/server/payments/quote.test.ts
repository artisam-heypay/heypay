import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec, phpToAsset, type Decimal } from "@/lib/money";
import { AppError } from "@/lib/errors";
import type { PaymentAsset } from "@/lib/assets";

const RATES: Record<PaymentAsset, string> = { XLM: "12", USDT: "58", USDC: "62.34" };
const { getDepositAddress, canReceive, getQuote } = vi.hoisted(() => ({
  getDepositAddress: vi.fn(async (_asset: string) => ({ address: "GTREASURY", memo: null })),
  canReceive: vi.fn(async (_pk: string, _asset: string) => true),
  getQuote: vi.fn(),
}));

vi.mock("@/server/stellar/wallet", () => ({
  walletService: { canReceive: (pk: string, a: string) => canReceive(pk, a) },
}));

vi.mock("@/server/rails", () => ({
  rail: {
    supportsAsset: () => true,
    getDepositAddress: (a: string) => getDepositAddress(a),
    getQuote: (i: unknown) => getQuote(i),
  },
}));

function liveQuote({ sell, phpAmount }: { sell: PaymentAsset; phpAmount: Decimal }) {
  const rate = dec(RATES[sell]);
  return Promise.resolve({
    asset: sell,
    rate,
    phpAmount,
    assetAmount: phpToAsset(phpAmount, rate),
    expiresAt: new Date(Date.now() + 90_000),
    source: "COINSPH",
  });
}

import { createQuote } from "./quote";

beforeEach(async () => {
  vi.clearAllMocks();
  getDepositAddress.mockResolvedValue({ address: "GTREASURY", memo: null });
  canReceive.mockResolvedValue(true);
  getQuote.mockImplementation(liveQuote);
  await resetDb();
});
afterEach(() => {
  delete process.env.PAYMENT_ASSETS;
});

describe("createQuote", () => {
  it("computes amountAsset (ROUND_UP) + base fee and persists a QUOTED Payment + rate snapshot", async () => {
    const { user } = await makePayer({ cachedXlm: "100.0000000" });
    const { merchant } = await makeMerchant();
    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("100"),
    });

    expect(res.asset).toBe("XLM");
    expect(res.settlementAsset).toBe("XLM");
    expect(res.rate.toString()).toBe("12");
    // 100 / 12 = 8.3333333... → ROUND_UP at 7dp = 8.3333334
    expect(res.amountAsset.toFixed(7)).toBe("8.3333334");
    expect(res.networkFeeXlm.toFixed(7)).toBe("0.0000100");
    expect(res.reference).toMatch(/^TXN-[A-Z2-7]{8}$/);

    const payment = await db.payment.findUniqueOrThrow({ where: { id: res.paymentId } });
    expect(payment.status).toBe("QUOTED");
    expect(payment.quotedRate.toString()).toBe("12");
    expect(payment.settlementAmount).toBeNull();
    const events = await db.paymentEvent.findMany({ where: { paymentId: res.paymentId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: "CREATED", toStatus: "QUOTED" });
  });

  it("records where the rate came from on the snapshot and the quote event", async () => {
    const { user } = await makePayer({ cachedXlm: "100.0000000" });
    const { merchant } = await makeMerchant();
    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("100"),
    });

    const snap = await db.exchangeRateSnapshot.findFirstOrThrow();
    expect(snap).toMatchObject({ pair: "XLMPHP", source: "COINSPH" });
    const event = await db.paymentEvent.findFirstOrThrow({ where: { paymentId: res.paymentId } });
    expect(event.detail).toMatchObject({ rateSource: "COINSPH" });
  });

  it("surfaces a price-source refusal as-is, without retrying it", async () => {
    getQuote.mockRejectedValue(new AppError("RATE_UNAVAILABLE", "prices disagree", 503));
    const { user } = await makePayer({ cachedXlm: "100.0000000" });
    const { merchant } = await makeMerchant();

    await expect(
      createQuote({ payerId: user.id, merchantId: merchant.id, amountPhp: dec("100") }),
    ).rejects.toMatchObject({ code: "RATE_UNAVAILABLE", status: 503 });
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(await db.payment.count()).toBe(0);
  });

  it("rejects insufficient available funds with conflict (409)", async () => {
    const { user } = await makePayer({ cachedXlm: "5.0000000" }); // needs ~8.33 XLM
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({ payerId: user.id, merchantId: merchant.id, amountPhp: dec("100") }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.payment.count()).toBe(0);
  });

  it("rejects a non-ACTIVE merchant with notFound (404)", async () => {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant({ status: "DRAFT" });
    await expect(
      createQuote({ payerId: user.id, merchantId: merchant.id, amountPhp: dec("100") }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a disabled asset with badRequest (400)", async () => {
    process.env.PAYMENT_ASSETS = "XLM,USDC";
    const { user } = await makePayer();
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: dec("100"),
        asset: "USDT",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await db.payment.count()).toBe(0);
  });

  it("refuses when the treasury cannot receive the asset (no trustline)", async () => {
    // Stellar rejects a payment to an account with no trustline (op_no_trust),
    // but only at submission — after the payer has confirmed. Catch it at quote.
    process.env.PAYMENT_ASSETS = "XLM,USDC";
    canReceive.mockResolvedValue(false);
    const { user } = await makePayer({ assets: { USDC: { cached: "50.0000000" } } });
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: dec("100"),
        asset: "USDC",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(canReceive).toHaveBeenCalledWith("GTREASURY", "USDC");
    expect(getQuote).not.toHaveBeenCalled();
    expect(await db.payment.count()).toBe(0);
  });
});

describe("createQuote (USDC)", () => {
  beforeEach(() => {
    process.env.PAYMENT_ASSETS = "XLM,USDC";
  });

  it("quotes against the USDC rate and reserves nothing until confirm", async () => {
    const { user } = await makePayer({
      cachedXlm: "5.0000000",
      assets: { USDC: { cached: "50.0000000" } },
    });
    const { merchant } = await makeMerchant();
    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("100"),
      asset: "USDC",
    });

    expect(res.asset).toBe("USDC");
    expect(res.settlementAsset).toBe("USDC"); // no conversion: the treasury takes USDC
    expect(res.rate.toString()).toBe("62.34");
    // 100 / 62.34 = 1.60410651... → ROUND_UP at 7dp
    expect(res.amountAsset.toFixed(7)).toBe("1.6041066");
    // The Stellar fee is charged in XLM even for a USDC payment.
    expect(res.networkFeeXlm.toFixed(7)).toBe("0.0000100");

    const snap = await db.exchangeRateSnapshot.findFirstOrThrow();
    expect(snap.pair).toBe("USDCPHP");
  });

  it("checks the USDC balance, not the XLM one", async () => {
    const { user } = await makePayer({
      cachedXlm: "1000.0000000",
      assets: { USDC: { cached: "1.0000000" } },
    });
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: dec("100"),
        asset: "USDC",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects when the wallet holds USDC but no XLM for the network fee", async () => {
    const { user } = await makePayer({
      cachedXlm: "0.0000000",
      assets: { USDC: { cached: "50.0000000" } },
    });
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: dec("100"),
        asset: "USDC",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
