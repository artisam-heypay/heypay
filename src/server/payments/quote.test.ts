import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import type { PaymentAsset } from "@/lib/assets";

const RATES: Record<PaymentAsset, string> = { XLM: "12", USDT: "58", USDC: "58" };
const { supportsAsset, minSellAmount, getDepositAddress, canReceive, findConversionRoute } =
  vi.hoisted(() => ({
    findConversionRoute: vi.fn(),
    supportsAsset: vi.fn((_asset: string) => true),
    minSellAmount: vi.fn((_asset: string) => null as import("@/lib/money").Decimal | null),
    getDepositAddress: vi.fn(async (_asset: string) => ({ address: "GRAIL", memo: null })),
    canReceive: vi.fn(async (_pk: string, _asset: string) => true),
  }));

vi.mock("@/server/stellar/wallet", () => ({
  walletService: { canReceive: (pk: string, a: string) => canReceive(pk, a) },
}));

vi.mock("@/server/stellar/paths", () => ({
  findConversionRoute: (f: string, t: string, d: unknown) => findConversionRoute(f, t, d),
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
    vi.clearAllMocks();
    supportsAsset.mockReturnValue(true);
    minSellAmount.mockReturnValue(null);
    getDepositAddress.mockResolvedValue({ address: "GRAIL", memo: null });
    canReceive.mockResolvedValue(true);
    findConversionRoute.mockResolvedValue({ sourceAmount: dec("1"), path: [] });
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

  it("converts on the DEX when the rail cannot receive the asset directly", async () => {
    // PDAX's wallet takes XLM but holds no USDC trustline. Rather than refuse,
    // the payment converts USDC -> XLM on the way in, and the rail sells XLM.
    process.env.PAYMENT_ASSETS = "XLM,USDC";
    canReceive.mockImplementation(async (_pk: string, a: string) => a === "XLM");
    // Delivering the XLM the merchant needs costs 17 USDC on the book.
    findConversionRoute.mockResolvedValue({ sourceAmount: dec("17"), path: [] });

    const { user } = await makePayer({ assets: { USDC: { cached: "100.0000000" } } });
    const { merchant } = await makeMerchant();
    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("1000"),
      asset: "USDC",
    });

    expect(res.asset).toBe("USDC");
    expect(res.settlementAsset).toBe("XLM");
    // The DEX asks 17 USDC (17.17 with slippage), below what ₱1000 of USDC is
    // worth at the reference rate of 58 — so the payer is charged the market
    // amount, not the cheaper book price.
    expect(res.amountAsset.toFixed(7)).toBe("17.2413794");

    const payment = await db.payment.findUniqueOrThrow({ where: { id: res.paymentId } });
    expect(payment.settlementAsset).toBe("XLM");
    // ₱1000 at the XLM rate of 12 = 83.3333334 XLM must reach the rail.
    expect(payment.settlementAmount?.toFixed(7)).toBe("83.3333334");
    // The rail was quoted in XLM — the asset it actually sells. (A USDCPHP
    // snapshot also exists: the overpricing guard prices the payer's asset.)
    const snap = await db.exchangeRateSnapshot.findFirstOrThrow({ where: { source: "PDAX" } });
    expect(snap.pair).toBe("XLMPHP");
  });

  it("refuses a conversion that would overcharge the payer", async () => {
    // A thin book can quote any price. ₱1000 of USDC is ~17.24 USDC at the
    // reference rate; 40 USDC is far beyond the 5% cap.
    process.env.PAYMENT_ASSETS = "XLM,USDC";
    canReceive.mockImplementation(async (_pk: string, a: string) => a === "XLM");
    findConversionRoute.mockResolvedValue({ sourceAmount: dec("40"), path: [] });

    const { user } = await makePayer({ assets: { USDC: { cached: "100.0000000" } } });
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: dec("1000"),
        asset: "USDC",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("far above"),
    });
    expect(await db.payment.count()).toBe(0);
  });

  it("charges the market price when the DEX is mispriced in the payer's favour", async () => {
    // Testnet sells XLM almost free, implying ₱406,101 per USDC. Quoting that
    // would be nonsense on the confirm screen and a windfall taken from whoever
    // posted the stale offer, so the payer is charged what USDC is actually
    // worth. The rail still receives the full amount the merchant is owed.
    process.env.PAYMENT_ASSETS = "XLM,USDC";
    canReceive.mockImplementation(async (_pk: string, a: string) => a === "XLM");
    findConversionRoute.mockResolvedValue({ sourceAmount: dec("0.0024604"), path: [] });

    const { user } = await makePayer({ assets: { USDC: { cached: "100.0000000" } } });
    const { merchant } = await makeMerchant();
    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("1000"),
      asset: "USDC",
    });
    expect(res.settlementAsset).toBe("XLM");
    // ₱1000 at the USDC reference rate of 58, not the DEX's 0.0024604.
    expect(res.amountAsset.toFixed(7)).toBe("17.2413794");
    expect(res.rate.toFixed(2)).toBe("58.00");
  });

  it("charges the DEX price when it is dearer than market but within the cap", async () => {
    process.env.PAYMENT_ASSETS = "XLM,USDC";
    canReceive.mockImplementation(async (_pk: string, a: string) => a === "XLM");
    // 17.5 USDC is above the 17.2413794 market amount, inside the 5% cap.
    findConversionRoute.mockResolvedValue({ sourceAmount: dec("17.5"), path: [] });

    const { user } = await makePayer({ assets: { USDC: { cached: "100.0000000" } } });
    const { merchant } = await makeMerchant();
    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("1000"),
      asset: "USDC",
    });
    // Plus the 1% slippage head-room.
    expect(res.amountAsset.toFixed(7)).toBe("17.6750000");
  });

  it("refuses when the DEX has no route with enough liquidity", async () => {
    // Testnet USDT has ~0.3 XLM of depth. Submitting anyway would fail on-chain
    // after the payer confirmed.
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    canReceive.mockImplementation(async (_pk: string, a: string) => a === "XLM");
    findConversionRoute.mockResolvedValue(null);

    const { user } = await makePayer({ assets: { USDT: { cached: "500.0000000" } } });
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: dec("1000"),
        asset: "USDT",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("too little USDT liquidity"),
    });
    expect(await db.payment.count()).toBe(0);
  });

  it("settles directly, recording no conversion, when the rail takes the asset", async () => {
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    const { user } = await makePayer({ assets: { USDT: { cached: "50.0000000" } } });
    const { merchant } = await makeMerchant();
    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("100"),
      asset: "USDT",
    });

    expect(res.settlementAsset).toBe("USDT");
    const payment = await db.payment.findUniqueOrThrow({ where: { id: res.paymentId } });
    expect(payment.settlementAmount).toBeNull();
    expect(findConversionRoute).not.toHaveBeenCalled();
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
      message: expect.stringContaining("2 USDT"),
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

  it("converts an asset the rail cannot trade into one it can", async () => {
    // The rail has no USDTPHP pair, but it trades XLM. Converting on the DEX is
    // a better answer than refusing the payment.
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    supportsAsset.mockImplementation((a: string) => a === "XLM");
    findConversionRoute.mockResolvedValue({ sourceAmount: dec("2"), path: [] });
    const { user } = await makePayer({ assets: { USDT: { cached: "50.0000000" } } });
    const { merchant } = await makeMerchant();

    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("100"),
      asset: "USDT",
    });
    expect(res.asset).toBe("USDT");
    expect(res.settlementAsset).toBe("XLM");
  });
});

describe("createQuote (USDT)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    supportsAsset.mockReturnValue(true);
    minSellAmount.mockReturnValue(null);
    getDepositAddress.mockResolvedValue({ address: "GRAIL", memo: null });
    canReceive.mockResolvedValue(true);
    findConversionRoute.mockResolvedValue({ sourceAmount: dec("1"), path: [] });
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
