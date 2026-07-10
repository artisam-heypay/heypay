import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import type { PaymentAsset } from "@/lib/assets";

const RATES: Record<PaymentAsset, string> = { XLM: "12", USDT: "58", USDC: "58" };
const { supportsAsset, minSellAmount, getDepositAddress, canReceive } = vi.hoisted(() => ({
  supportsAsset: vi.fn((_asset: string) => true),
  minSellAmount: vi.fn((_asset: string) => null as import("@/lib/money").Decimal | null),
  getDepositAddress: vi.fn(async (_asset: string) => ({ address: "GRAIL", memo: null })),
  canReceive: vi.fn(async (_pk: string, _asset: string) => true),
}));

vi.mock("@/server/stellar/wallet", () => ({
  walletService: { canReceive: (pk: string, a: string) => canReceive(pk, a) },
}));

vi.mock("@/server/rails", () => ({
  rail: {
    supportsAsset: (a: string) => supportsAsset(a),
    minSellAmount: (a: string) => minSellAmount(a),
    getDepositAddress: (a: string) => getDepositAddress(a),
    getQuote: vi.fn(
      async ({
        sell,
        phpAmount,
      }: {
        sell: PaymentAsset;
        phpAmount: import("@/lib/money").Decimal;
      }) => {
        const rate = dec(RATES[sell]);
        return {
          asset: sell,
          rate,
          phpAmount,
          assetAmount: phpAmount.div(rate),
          expiresAt: new Date(Date.now() + 90_000),
        };
      },
    ),
  },
}));

import { createQuote } from "./quote";

describe("createQuote", () => {
  beforeEach(async () => {
    supportsAsset.mockReturnValue(true);
    minSellAmount.mockReturnValue(null);
    getDepositAddress.mockResolvedValue({ address: "GRAIL", memo: null });
    canReceive.mockResolvedValue(true);
    await resetDb();
  });
  afterEach(() => {
    delete process.env.PAYMENT_ASSETS;
  });

  it("computes amountAsset (ROUND_UP) + base fee and persists a QUOTED Payment + rate snapshot", async () => {
    const { user } = await makePayer({ cachedXlm: "100.0000000" });
    const { merchant } = await makeMerchant();
    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("100"),
    });

    expect(res.asset).toBe("XLM");
    expect(res.rate.toString()).toBe("12");
    // 100 / 12 = 8.3333333... → ROUND_UP at 7dp = 8.3333334
    expect(res.amountAsset.toFixed(7)).toBe("8.3333334");
    expect(res.networkFeeXlm.toFixed(7)).toBe("0.0000100");
    expect(res.reference).toMatch(/^TXN-[A-Z2-7]{8}$/);

    const payment = await db.payment.findUniqueOrThrow({ where: { id: res.paymentId } });
    expect(payment.status).toBe("QUOTED");
    expect(payment.quotedRate.toString()).toBe("12");
    const snap = await db.exchangeRateSnapshot.findFirstOrThrow();
    expect(snap.pair).toBe("XLMPHP");
    const events = await db.paymentEvent.findMany({ where: { paymentId: res.paymentId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: "CREATED", toStatus: "QUOTED" });
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

  it("refuses when the rail's deposit account cannot receive the asset", async () => {
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
    expect(await db.payment.count()).toBe(0);
  });

  it("refuses when the rail has no deposit wallet for the asset", async () => {
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    getDepositAddress.mockRejectedValue(new Error("FailedRetrievingWallet"));
    const { user } = await makePayer({ assets: { USDT: { cached: "50.0000000" } } });
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: dec("100"),
        asset: "USDT",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("names the minimum instead of letting the rail reject a small order", async () => {
    // PDAX enforces a minimum crypto quantity; ₱100 of USDT at 58 is 1.73 USDT,
    // under the 2 USDT floor.
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    minSellAmount.mockImplementation((a: string) => (a === "USDT" ? dec("2") : null));
    const { user } = await makePayer({ assets: { USDT: { cached: "50.0000000" } } });
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: dec("100"),
        asset: "USDT",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("minimum USDT payment is 2 USDT"),
    });
  });

  it("allows an order that clears the rail minimum", async () => {
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    minSellAmount.mockImplementation((a: string) => (a === "USDT" ? dec("2") : null));
    const { user } = await makePayer({ assets: { USDT: { cached: "50.0000000" } } });
    const { merchant } = await makeMerchant();
    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("300"),
      asset: "USDT",
    });
    expect(res.amountAsset.greaterThanOrEqualTo(dec("2"))).toBe(true);
  });

  it("rejects an enabled asset the rail cannot settle with badRequest (400)", async () => {
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    supportsAsset.mockImplementation((a: string) => a === "XLM");
    const { user } = await makePayer({ assets: { USDT: { cached: "50.0000000" } } });
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: dec("100"),
        asset: "USDT",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("createQuote (USDT)", () => {
  beforeEach(async () => {
    supportsAsset.mockReturnValue(true);
    minSellAmount.mockReturnValue(null);
    getDepositAddress.mockResolvedValue({ address: "GRAIL", memo: null });
    canReceive.mockResolvedValue(true);
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    await resetDb();
  });
  afterEach(() => {
    delete process.env.PAYMENT_ASSETS;
  });

  it("quotes against the USDT rate and reserves nothing until confirm", async () => {
    const { user } = await makePayer({
      cachedXlm: "5.0000000",
      assets: { USDT: { cached: "50.0000000" } },
    });
    const { merchant } = await makeMerchant();
    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("100"),
      asset: "USDT",
    });

    expect(res.asset).toBe("USDT");
    expect(res.rate.toString()).toBe("58");
    // 100 / 58 = 1.7241379310... → ROUND_UP at 7dp
    expect(res.amountAsset.toFixed(7)).toBe("1.7241380");
    // The Stellar fee is charged in XLM even for a USDT payment.
    expect(res.networkFeeXlm.toFixed(7)).toBe("0.0000100");

    const payment = await db.payment.findUniqueOrThrow({ where: { id: res.paymentId } });
    expect(payment.asset).toBe("USDT");
    expect(payment.amountAsset.toFixed(7)).toBe("1.7241380");
    const snap = await db.exchangeRateSnapshot.findFirstOrThrow();
    expect(snap.pair).toBe("USDTPHP");
  });

  it("checks the USDT balance, not the XLM one", async () => {
    // Plenty of XLM, not enough USDT.
    const { user } = await makePayer({
      cachedXlm: "1000.0000000",
      assets: { USDT: { cached: "1.0000000" } },
    });
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: dec("100"),
        asset: "USDT",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects when the wallet holds USDT but no XLM for the network fee", async () => {
    const { user } = await makePayer({
      cachedXlm: "0.0000000",
      assets: { USDT: { cached: "50.0000000" } },
    });
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: dec("100"),
        asset: "USDT",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
