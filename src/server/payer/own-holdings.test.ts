import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dec } from "@/lib/money";

const { getBalances, lockedXlm, getAssetRate } = vi.hoisted(() => ({
  getBalances: vi.fn(),
  lockedXlm: vi.fn(),
  getAssetRate: vi.fn(),
}));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: {
    getBalances: (account: string, assets: string[]) => getBalances(account, assets),
    lockedXlm: (account: string) => lockedXlm(account),
  },
}));
vi.mock("@/server/payments/rate", () => ({ getAssetRate: (asset: string) => getAssetRate(asset) }));
vi.mock("@/server/stellar/assets", () => ({ isAssetConfigured: () => true }));

import { getOwnWalletHoldings, holdingsSnapshot } from "./holdings";

const OWN = "GOWNWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

beforeEach(() => {
  process.env.PAYMENT_ASSETS = "XLM,USDC";
  process.env.ESCROW_ENABLED = "true";
  process.env.ESCROW_FEE_ESTIMATE_XLM = "0.2";
  getBalances.mockReset().mockResolvedValue([
    { asset: "XLM", balance: dec("100.0000000"), trustline: true },
    { asset: "USDC", balance: dec("0.0000000"), trustline: false },
  ]);
  // The network keeps 1.5 XLM in this account.
  lockedXlm.mockReset().mockResolvedValue(dec("1.5"));
  getAssetRate
    .mockReset()
    .mockImplementation(async (asset: string) => (asset === "XLM" ? dec("12") : dec("58")));
});
afterEach(() => {
  delete process.env.PAYMENT_ASSETS;
  delete process.env.ESCROW_ENABLED;
  delete process.env.ESCROW_FEE_ESTIMATE_XLM;
});

describe("getOwnWalletHoldings", () => {
  it("reads the account from the chain and prices it like the HeyPay wallet", async () => {
    const holdings = await getOwnWalletHoldings(OWN);

    expect(getBalances).toHaveBeenCalledWith(OWN, ["XLM", "USDC"]);
    expect(holdings.publicKey).toBe(OWN);
    expect(holdings.totalPhp.toFixed(2)).toBe("1200.00");
    const xlm = holdings.tokens.find((t) => t.asset === "XLM")!;
    expect(xlm.balance.toFixed(7)).toBe("100.0000000");
    expect(xlm.valuePhp?.toFixed(2)).toBe("1200.00");
  });

  it("counts as spendable only what a payment can use: less the minimum balance and the fees", async () => {
    const holdings = await getOwnWalletHoldings(OWN);

    const xlm = holdings.tokens.find((t) => t.asset === "XLM")!;
    // 100 - 1.5 kept by the network - 0.0000100 base fee - 0.2 escrow fee
    expect(xlm.available.toFixed(7)).toBe("98.2999900");
    expect(xlm.reserved.toFixed(7)).toBe("1.7000100");
  });

  it("never counts a negative spendable balance", async () => {
    getBalances.mockResolvedValue([
      { asset: "XLM", balance: dec("1.0000000"), trustline: true },
      { asset: "USDC", balance: dec("0"), trustline: false },
    ]);
    const holdings = await getOwnWalletHoldings(OWN);
    expect(holdings.tokens.find((t) => t.asset === "XLM")!.available.toFixed(7)).toBe("0.0000000");
  });

  it("says when the wallet cannot hold an issued asset yet", async () => {
    const holdings = await getOwnWalletHoldings(OWN);
    const usdc = holdings.tokens.find((t) => t.asset === "USDC")!;
    expect(usdc.canReceive).toBe(false);
    expect(holdingsSnapshot(holdings).tokens.find((t) => t.asset === "USDC")).toMatchObject({
      balance: "0.0000000",
      canReceive: false,
    });
  });

  it("throws when the chain cannot be read, so a page never shows it as empty", async () => {
    getBalances.mockRejectedValue(new Error("Horizon down"));
    await expect(getOwnWalletHoldings(OWN)).rejects.toThrow("Horizon down");
  });
});
