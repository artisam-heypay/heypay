import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec, phpToAsset, type Decimal } from "@/lib/money";
import { AppError } from "@/lib/errors";
import type { PaymentAsset } from "@/lib/assets";

const RATES: Record<PaymentAsset, string> = { XLM: "12", USDT: "58", USDC: "62.34" };
const XLM_ESCROW = "CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J";
const USDC_ESCROW = "CAR76EFULGIFGWV4UQIFP5J5GUSRUMBQ3CH4TY5GW4FJCXKDXNYI66EG";
const {
  getDepositAddress,
  canReceive,
  holdsOtherIssuer,
  lockedXlm,
  getQuote,
  findStrictSendPaths,
  escrowHoldsAsset,
} = vi.hoisted(() => ({
  getDepositAddress: vi.fn(async (_asset: string) => ({ address: "GTREASURY", memo: null })),
  canReceive: vi.fn(async (_pk: string, _asset: string) => true),
  holdsOtherIssuer: vi.fn(async (_pk: string, _asset: string) => false),
  lockedXlm: vi.fn(),
  getQuote: vi.fn(),
  findStrictSendPaths: vi.fn(),
  escrowHoldsAsset: vi.fn(async (_asset: string) => true),
}));

vi.mock("@/server/stellar/escrow", () => ({
  escrowHoldsAsset: (asset: string) => escrowHoldsAsset(asset),
}));

vi.mock("@/server/stellar/wallet", () => ({
  walletService: {
    canReceive: (pk: string, a: string) => canReceive(pk, a),
    holdsOtherIssuer: (pk: string, a: string) => holdsOtherIssuer(pk, a),
    lockedXlm: (pk: string) => lockedXlm(pk),
  },
}));

vi.mock("@/server/stellar/paths", () => ({
  findStrictSendPaths: (...args: unknown[]) => findStrictSendPaths(...args),
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
  findStrictSendPaths.mockResolvedValue([]);
  escrowHoldsAsset.mockResolvedValue(true);
  holdsOtherIssuer.mockResolvedValue(false);
  lockedXlm.mockResolvedValue(dec("0"));
  await resetDb();
});
afterEach(() => {
  delete process.env.PAYMENT_ASSETS;
  delete process.env.ESCROW_ENABLED;
  delete process.env.ESCROW_CONTRACT_ID;
  delete process.env.ESCROW_CONTRACT_ID_USDC;
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

  it("reserves the escrow fee estimate on top of the amount when the escrow is on", async () => {
    // 8.4 covers 8.3333334 + the 0.00001 base fee, but not the 0.2 XLM escrow fee estimate.
    const { user } = await makePayer({ cachedXlm: "8.4000000" });
    const { merchant } = await makeMerchant();

    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID = XLM_ESCROW;
    await expect(
      createQuote({ payerId: user.id, merchantId: merchant.id, amountPhp: dec("100") }),
    ).rejects.toMatchObject({ status: 409 });

    delete process.env.ESCROW_ENABLED;
    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("100"),
    });
    expect(res.amountAsset.toFixed(7)).toBe("8.3333334");
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
    canReceive.mockImplementation(async (pk: string) => pk !== "GTREASURY");
    const { user } = await makePayer({ assets: { USDC: { cached: "50.0000000" } } });
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: dec("100"),
        asset: "USDC",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "This shop is paid in a different currency. Pay with XLM instead.",
      details: { reason: "asset_mismatch", cause: "destination", asset: "USDC", payWith: "XLM" },
    });
    expect(canReceive).toHaveBeenCalledWith("GTREASURY", "USDC");
    expect(await db.payment.count()).toBe(0);
  });
});

describe("createQuote (settlement route preflight)", () => {
  beforeEach(() => {
    process.env.PAYMENT_ASSETS = "XLM,USDC";
  });

  const usdcQuote = (payerId: string, merchantId: string) =>
    createQuote({ payerId, merchantId, amountPhp: dec("100"), asset: "USDC" });

  it("records the escrow that will hold the payment on the quote event", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID = XLM_ESCROW;
    const { user } = await makePayer({ cachedXlm: "100.0000000" });
    const { merchant } = await makeMerchant();
    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("100"),
    });
    const event = await db.paymentEvent.findFirstOrThrow({ where: { paymentId: res.paymentId } });
    expect(event.detail).toMatchObject({ escrowId: XLM_ESCROW });
  });

  it("refuses when the escrow is on but no instance is deployed for the asset", async () => {
    process.env.ESCROW_ENABLED = "true";
    const { user } = await makePayer({ cachedXlm: "100.0000000" });
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({ payerId: user.id, merchantId: merchant.id, amountPhp: dec("100") }),
    ).rejects.toMatchObject({
      status: 400,
      message: "HeyPay cannot hold XLM payments in escrow right now.",
      details: { reason: "no_escrow" },
    });
    expect(await db.payment.count()).toBe(0);
  });

  it("refuses when the payer's wallet has no trustline on-chain, whatever the cache says", async () => {
    const { user, wallet } = await makePayer({ assets: { USDC: { cached: "50.0000000" } } });
    const { merchant } = await makeMerchant();
    canReceive.mockImplementation(async (pk: string) => pk !== wallet.stellarPublicKey);
    await expect(usdcQuote(user.id, merchant.id)).rejects.toMatchObject({
      status: 400,
      message: "Turn on USDC first.",
      details: { reason: "payer_no_trustline", asset: "USDC" },
    });
    expect(await db.payment.count()).toBe(0);
  });

  it("refuses when USDC would have to be converted and the DEX has no route", async () => {
    const { user } = await makePayer({ assets: { USDC: { cached: "50.0000000" } } });
    const { merchant } = await makeMerchant();
    // The treasury takes XLM but holds no USDC trustline.
    canReceive.mockImplementation(
      async (pk: string, asset: string) => pk !== "GTREASURY" || asset === "XLM",
    );
    await expect(usdcQuote(user.id, merchant.id)).rejects.toMatchObject({
      status: 400,
      message:
        "USDC cannot be converted for this amount right now. Try a smaller amount or another asset.",
      details: { reason: "no_dex_path" },
    });
    // 100 / 62.34 → 1.6041066 USDC is the amount the DEX was asked to convert.
    expect(findStrictSendPaths.mock.calls[0]![2].toFixed(7)).toBe("1.6041066");
    expect(await db.payment.count()).toBe(0);
  });

  it("still refuses when a DEX route exists: settlement delivers the payer's own asset only", async () => {
    const { user } = await makePayer({ assets: { USDC: { cached: "50.0000000" } } });
    const { merchant } = await makeMerchant();
    canReceive.mockImplementation(
      async (pk: string, asset: string) => pk !== "GTREASURY" || asset === "XLM",
    );
    findStrictSendPaths.mockResolvedValue([{ destAmount: dec("9.7684000"), path: [] }]);
    await expect(usdcQuote(user.id, merchant.id)).rejects.toMatchObject({
      status: 400,
      details: { reason: "asset_mismatch", cause: "destination" },
    });
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

  it("names the USDC escrow, not the XLM one, as the holder of a USDC payment", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID = XLM_ESCROW;
    process.env.ESCROW_CONTRACT_ID_USDC = USDC_ESCROW;
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
    const event = await db.paymentEvent.findFirstOrThrow({ where: { paymentId: res.paymentId } });
    expect(event.detail).toMatchObject({ escrowId: USDC_ESCROW });
  });

  it("refuses USDC when the escrow is on and no USDC instance is deployed", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID = XLM_ESCROW;
    const { user } = await makePayer({ assets: { USDC: { cached: "50.0000000" } } });
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: dec("100"),
        asset: "USDC",
      }),
    ).rejects.toMatchObject({ status: 400, details: { reason: "no_escrow" } });
    expect(await db.payment.count()).toBe(0);
  });

  it("needs XLM for the escrow deposit's fee, on top of the USDC amount", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID_USDC = USDC_ESCROW;
    // Plenty of USDC, but less XLM than the 0.2 XLM fee estimate.
    const { user } = await makePayer({
      cachedXlm: "0.1000000",
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
    ).rejects.toMatchObject({ status: 409, details: { requiredXlm: "0.2000100" } });
    expect(await db.payment.count()).toBe(0);
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

describe("createQuote (USDC edge cases)", () => {
  beforeEach(() => {
    process.env.PAYMENT_ASSETS = "XLM,USDC";
  });

  const usdcQuote = (payerId: string, merchantId: string) =>
    createQuote({ payerId, merchantId, amountPhp: dec("100"), asset: "USDC" });

  /** Nothing was saved and nothing is held on either balance. */
  async function expectNothingMoved(walletId: string, cachedUsdc: string, cachedXlm: string) {
    expect(await db.payment.count()).toBe(0);
    expect(await db.walletTransaction.count()).toBe(0);
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(w.cachedXlmBalance.toFixed(7)).toBe(cachedXlm);
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000");
    const usdc = await db.walletBalance.findUnique({
      where: { walletId_asset: { walletId, asset: "USDC" } },
    });
    expect(usdc?.cached.toFixed(7) ?? "0.0000000").toBe(cachedUsdc);
    expect(usdc?.reserved.toFixed(7) ?? "0.0000000").toBe("0.0000000");
  }

  it("missing trustline: tells the payer to turn on USDC first", async () => {
    const { user, wallet } = await makePayer({ cachedXlm: "10.0000000" });
    const { merchant } = await makeMerchant();
    canReceive.mockImplementation(async (pk: string) => pk !== wallet.stellarPublicKey);

    await expect(usdcQuote(user.id, merchant.id)).rejects.toMatchObject({
      status: 400,
      message: "Turn on USDC first.",
      details: { reason: "payer_no_trustline", asset: "USDC" },
    });
    await expectNothingMoved(wallet.id, "0.0000000", "10.0000000");
  });

  it("asset mismatch: refuses when the USDC escrow holds another asset", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID_USDC = XLM_ESCROW;
    escrowHoldsAsset.mockResolvedValue(false);
    const { user, wallet } = await makePayer({
      cachedXlm: "10.0000000",
      assets: { USDC: { cached: "50.0000000" } },
    });
    const { merchant } = await makeMerchant();

    await expect(usdcQuote(user.id, merchant.id)).rejects.toMatchObject({
      status: 400,
      message: "This shop is paid in a different currency. Pay with XLM instead.",
      details: { reason: "asset_mismatch", cause: "escrow", asset: "USDC", payWith: "XLM" },
    });
    await expectNothingMoved(wallet.id, "50.0000000", "10.0000000");
  });

  it("asset mismatch: the payer's USDC is from another issuer, with ours never turned on", async () => {
    const { user, wallet } = await makePayer({ cachedXlm: "10.0000000" });
    const { merchant } = await makeMerchant();
    canReceive.mockImplementation(async (pk: string) => pk !== wallet.stellarPublicKey);
    holdsOtherIssuer.mockResolvedValue(true);

    await expect(usdcQuote(user.id, merchant.id)).rejects.toMatchObject({
      status: 400,
      message:
        "Your USDC is from a different issuer than the one HeyPay accepts, so it can't be used here. Pay with XLM instead.",
      details: { reason: "asset_mismatch", cause: "payer_issuer", asset: "USDC", payWith: "XLM" },
    });
    expect(holdsOtherIssuer).toHaveBeenCalledWith(wallet.stellarPublicKey, "USDC");
    await expectNothingMoved(wallet.id, "0.0000000", "10.0000000");
  });

  it("asset mismatch: too little of our USDC, but another issuer's in the wallet", async () => {
    const { user, wallet } = await makePayer({
      cachedXlm: "10.0000000",
      assets: { USDC: { cached: "0.5000000" } },
    });
    const { merchant } = await makeMerchant();
    holdsOtherIssuer.mockResolvedValue(true);

    await expect(usdcQuote(user.id, merchant.id)).rejects.toMatchObject({
      status: 400,
      message:
        "Your USDC is from a different issuer than the one HeyPay accepts, so it can't be used here. Pay with XLM instead.",
      details: { reason: "asset_mismatch", cause: "payer_issuer" },
    });
    await expectNothingMoved(wallet.id, "0.5000000", "10.0000000");
  });

  it("asset mismatch: the treasury cannot receive USDC", async () => {
    const { user, wallet } = await makePayer({
      cachedXlm: "10.0000000",
      assets: { USDC: { cached: "50.0000000" } },
    });
    const { merchant } = await makeMerchant();
    canReceive.mockImplementation(async (pk: string) => pk !== "GTREASURY");

    await expect(usdcQuote(user.id, merchant.id)).rejects.toMatchObject({
      status: 400,
      message: "This shop is paid in a different currency. Pay with XLM instead.",
      details: { reason: "asset_mismatch", cause: "destination", asset: "USDC", payWith: "XLM" },
    });
    await expectNothingMoved(wallet.id, "50.0000000", "10.0000000");
  });

  it("a treasury that cannot take XLM is an outage, not a mismatch", async () => {
    const { user } = await makePayer({ cachedXlm: "100.0000000" });
    const { merchant } = await makeMerchant();
    canReceive.mockImplementation(async (pk: string) => pk !== "GTREASURY");

    await expect(
      createQuote({ payerId: user.id, merchantId: merchant.id, amountPhp: dec("100") }),
    ).rejects.toMatchObject({
      status: 400,
      message: "HeyPay cannot receive XLM payments right now.",
      details: { reason: "destination_no_trustline", asset: "XLM" },
    });
  });

  it("insufficient balance stands when the chain cannot be asked about other issuers", async () => {
    const { user } = await makePayer({
      cachedXlm: "10.0000000",
      assets: { USDC: { cached: "1.0000000" } },
    });
    const { merchant } = await makeMerchant();
    holdsOtherIssuer.mockRejectedValue(new Error("horizon down"));

    await expect(usdcQuote(user.id, merchant.id)).rejects.toMatchObject({
      status: 409,
      details: { reason: "insufficient_balance" },
    });
  });

  it("insufficient balance: says to add USDC or pay with XLM", async () => {
    const { user, wallet } = await makePayer({
      cachedXlm: "10.0000000",
      assets: { USDC: { cached: "1.0000000" } },
    });
    const { merchant } = await makeMerchant();

    await expect(usdcQuote(user.id, merchant.id)).rejects.toMatchObject({
      status: 409,
      message: "Not enough USDC — add more or pay with XLM.",
      details: {
        reason: "insufficient_balance",
        asset: "USDC",
        payWith: "XLM",
        available: "1.0000000",
        required: "1.6041066",
      },
    });
    await expectNothingMoved(wallet.id, "1.0000000", "10.0000000");
  });

  it("insufficient balance: USDC held for another payment does not count", async () => {
    const { user, wallet } = await makePayer({
      cachedXlm: "10.0000000",
      assets: { USDC: { cached: "2.0000000", reserved: "1.0000000" } },
    });
    const { merchant } = await makeMerchant();

    await expect(usdcQuote(user.id, merchant.id)).rejects.toMatchObject({
      status: 409,
      details: { reason: "insufficient_balance", available: "1.0000000" },
    });
    expect(await db.payment.count()).toBe(0);
    const usdc = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDC" } },
    });
    expect(usdc.reserved.toFixed(7)).toBe("1.0000000"); // the other payment's hold, untouched
  });

  it("insufficient balance: enough USDC but no XLM for the network fee", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID_USDC = USDC_ESCROW;
    const { user, wallet } = await makePayer({
      cachedXlm: "0.1000000",
      assets: { USDC: { cached: "50.0000000" } },
    });
    const { merchant } = await makeMerchant();

    await expect(usdcQuote(user.id, merchant.id)).rejects.toMatchObject({
      status: 409,
      message: "Not enough XLM for the network fee — add about 0.21 XLM.",
      details: { reason: "insufficient_fee", asset: "USDC", requiredXlm: "0.2000100" },
    });
    await expectNothingMoved(wallet.id, "50.0000000", "0.1000000");
  });

  it("insufficient balance: XLM the network keeps locked does not pay the fee", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID_USDC = USDC_ESCROW;
    // Swapped down to the account's minimum balance: 1.5 XLM, none of it spendable.
    const { user, wallet } = await makePayer({
      cachedXlm: "1.5000000",
      assets: { USDC: { cached: "50.0000000" } },
    });
    const { merchant } = await makeMerchant();
    lockedXlm.mockResolvedValue(dec("1.5"));

    await expect(usdcQuote(user.id, merchant.id)).rejects.toMatchObject({
      status: 409,
      message: "Not enough XLM for the network fee — add about 0.21 XLM.",
      details: {
        reason: "insufficient_fee",
        asset: "USDC",
        availableXlm: "0.0000000",
        requiredXlm: "0.2000100",
      },
    });
    expect(lockedXlm).toHaveBeenCalledWith(wallet.stellarPublicKey);
    await expectNothingMoved(wallet.id, "50.0000000", "1.5000000");
  });

  it("quotes when the XLM above the locked minimum covers the fee", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID_USDC = USDC_ESCROW;
    const { user } = await makePayer({
      cachedXlm: "1.8000000",
      assets: { USDC: { cached: "50.0000000" } },
    });
    const { merchant } = await makeMerchant();
    lockedXlm.mockResolvedValue(dec("1.5"));

    const res = await usdcQuote(user.id, merchant.id);

    expect(res.asset).toBe("USDC");
  });

  it("checks the fee against the whole XLM balance when the chain cannot say what is locked", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID_USDC = USDC_ESCROW;
    const { user } = await makePayer({
      cachedXlm: "1.5000000",
      assets: { USDC: { cached: "50.0000000" } },
    });
    const { merchant } = await makeMerchant();
    lockedXlm.mockRejectedValue(new Error("horizon down"));

    const res = await usdcQuote(user.id, merchant.id);

    expect(res.asset).toBe("USDC");
  });

  it("an XLM payment short of XLM is not told to pay with XLM", async () => {
    const { user } = await makePayer({ cachedXlm: "1.0000000" });
    const { merchant } = await makeMerchant();

    await expect(
      createQuote({ payerId: user.id, merchantId: merchant.id, amountPhp: dec("100") }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Not enough XLM — add more.",
      details: { reason: "insufficient_balance", asset: "XLM" },
    });
  });
});
