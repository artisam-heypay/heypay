import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec, phpToAsset, type Decimal } from "@/lib/money";
import type { PaymentAsset } from "@/lib/assets";

const RATES: Record<PaymentAsset, string> = { XLM: "12", USDT: "58", USDC: "62.34" };
const XLM_ESCROW = "CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J";
const USDC_ESCROW = "CAR76EFULGIFGWV4UQIFP5J5GUSRUMBQ3CH4TY5GW4FJCXKDXNYI66EG";
// The payer's own account, as their wallet reported it when they connected.
const OWN = "GOWNWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

const { canReceive, lockedXlm, getBalances, getQuote } = vi.hoisted(() => ({
  canReceive: vi.fn(async (_pk: string, _asset: string) => true),
  lockedXlm: vi.fn(),
  getBalances: vi.fn(),
  getQuote: vi.fn(),
}));

vi.mock("@/server/stellar/escrow", () => ({ escrowHoldsAsset: async () => true }));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: {
    canReceive: (pk: string, a: string) => canReceive(pk, a),
    holdsOtherIssuer: async () => false,
    lockedXlm: (pk: string) => lockedXlm(pk),
    getBalances: (pk: string, assets: PaymentAsset[]) => getBalances(pk, assets),
  },
}));
vi.mock("@/server/stellar/paths", () => ({ findStrictSendPaths: async () => [] }));
vi.mock("@/server/rails", () => ({
  rail: {
    supportsAsset: () => true,
    getDepositAddress: async () => ({ address: "GTREASURY", memo: null }),
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

/** What the payer's own account holds on-chain. An asset left out has no line. */
function ownAccountHolds(held: Partial<Record<PaymentAsset, string>>) {
  getBalances.mockImplementation(async (_pk: string, assets: PaymentAsset[]) =>
    assets.map((asset) => ({
      asset,
      balance: dec(held[asset] ?? "0"),
      trustline: asset === "XLM" || asset in held,
    })),
  );
}

import { createQuote } from "./quote";

/** A payer who connected their own wallet. Their HeyPay wallet holds `heyPayXlm`. */
async function makeOwnWalletPayer(opts?: { heyPayXlm?: string; walletMode?: "CUSTODIAL" }) {
  const { user } = await makePayer({ cachedXlm: opts?.heyPayXlm ?? "0.0000000" });
  await db.user.update({
    where: { id: user.id },
    data: { externalPublicKey: OWN, walletMode: opts?.walletMode ?? "EXTERNAL" },
  });
  const { merchant } = await makeMerchant();
  return { user, merchant };
}

// ₱100 at 12 PHP/XLM is 8.3333334 XLM; at 62.34 PHP/USDC it is 1.6041066 USDC.
const quote = (payerId: string, merchantId: string, asset: PaymentAsset = "XLM") =>
  createQuote({ payerId, merchantId, amountPhp: dec("100"), asset });

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.NONCUSTODIAL_ENABLED = "true";
  process.env.PAYMENT_ASSETS = "XLM,USDC";
  canReceive.mockResolvedValue(true);
  getQuote.mockImplementation(liveQuote);
  lockedXlm.mockResolvedValue(dec("0"));
  ownAccountHolds({ XLM: "50" });
  await resetDb();
});
afterEach(() => {
  delete process.env.NONCUSTODIAL_ENABLED;
  delete process.env.PAYMENT_ASSETS;
  delete process.env.ESCROW_ENABLED;
  delete process.env.ESCROW_CONTRACT_ID;
  delete process.env.ESCROW_CONTRACT_ID_USDC;
});

describe("createQuote for a payer who pays from their own wallet", () => {
  it("quotes against their own account, whatever the HeyPay wallet holds", async () => {
    const { user, merchant } = await makeOwnWalletPayer({ heyPayXlm: "0.0000000" });

    const q = await quote(user.id, merchant.id);

    expect(q.amountAsset.toFixed(7)).toBe("8.3333334");
    expect(getBalances).toHaveBeenCalledWith(OWN, ["XLM"]);
    const payment = await db.payment.findUniqueOrThrow({ where: { id: q.paymentId } });
    expect(payment.status).toBe("QUOTED");
    // Whose account pays is recorded when the signed deposit is taken, not before.
    expect(payment.externalPublicKey).toBeNull();
  });

  it("refuses when their own account is short, though the HeyPay wallet holds plenty", async () => {
    ownAccountHolds({ XLM: "1" });
    const { user, merchant } = await makeOwnWalletPayer({ heyPayXlm: "100.0000000" });

    await expect(quote(user.id, merchant.id)).rejects.toMatchObject({
      status: 409,
      details: { reason: "own_wallet_short", available: "1.0000000", required: "8.3333334" },
    });
    expect(await db.payment.count()).toBe(0);
  });

  it("leaves out the XLM the network keeps locked in the account", async () => {
    ownAccountHolds({ XLM: "9" });
    lockedXlm.mockResolvedValue(dec("1"));
    const { user, merchant } = await makeOwnWalletPayer();

    await expect(quote(user.id, merchant.id)).rejects.toMatchObject({
      details: { reason: "own_wallet_short", available: "8.0000000" },
    });
  });

  it("needs XLM left over for the escrow deposit's fee, which their wallet pays", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID = XLM_ESCROW;
    ownAccountHolds({ XLM: "8.4" });
    const { user, merchant } = await makeOwnWalletPayer();

    await expect(quote(user.id, merchant.id)).rejects.toMatchObject({
      status: 409,
      details: { reason: "own_wallet_short_fee" },
    });
  });

  it("quotes USDC from their own account's USDC and XLM", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID_USDC = USDC_ESCROW;
    ownAccountHolds({ USDC: "5", XLM: "3" });
    const { user, merchant } = await makeOwnWalletPayer();

    const q = await quote(user.id, merchant.id, "USDC");

    expect(q.amountAsset.toFixed(7)).toBe("1.6041066");
    expect(getBalances).toHaveBeenCalledWith(OWN, ["USDC", "XLM"]);
  });

  it("refuses USDC when their own account has no XLM for the fees", async () => {
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID_USDC = USDC_ESCROW;
    ownAccountHolds({ USDC: "5", XLM: "0.05" });
    const { user, merchant } = await makeOwnWalletPayer();

    await expect(quote(user.id, merchant.id, "USDC")).rejects.toMatchObject({
      details: { reason: "own_wallet_short_fee" },
    });
  });

  it("says to add USDC to their wallet, and does not offer to turn it on in HeyPay", async () => {
    canReceive.mockImplementation(async (pk: string) => pk !== OWN);
    const { user, merchant } = await makeOwnWalletPayer();

    const refused = await quote(user.id, merchant.id, "USDC").catch((err: unknown) => err);

    expect(refused).toMatchObject({
      status: 409,
      message: expect.stringContaining("Add USDC to it"),
      details: { reason: "own_wallet_cannot_hold" },
    });
  });

  it("quotes a payer who switched back to the HeyPay wallet against that wallet", async () => {
    const { user, merchant } = await makeOwnWalletPayer({
      heyPayXlm: "100.0000000",
      walletMode: "CUSTODIAL",
    });

    await quote(user.id, merchant.id);

    expect(getBalances).not.toHaveBeenCalled();
  });

  it("quotes everyone against the HeyPay wallet while the feature is off", async () => {
    process.env.NONCUSTODIAL_ENABLED = "false";
    const { user, merchant } = await makeOwnWalletPayer({ heyPayXlm: "0.0000000" });

    await expect(quote(user.id, merchant.id)).rejects.toMatchObject({
      details: { reason: "insufficient_balance" },
    });
    expect(getBalances).not.toHaveBeenCalled();
  });
});
