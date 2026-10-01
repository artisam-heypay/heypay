import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDb, makePayer } from "../../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";

const { listIncomingPayments, getBalances, establishTrustline } = vi.hoisted(() => ({
  listIncomingPayments: vi.fn(),
  getBalances: vi.fn(),
  establishTrustline: vi.fn(),
}));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: {
    listIncomingPayments: (pk: string, c?: string, assets?: string[]) =>
      listIncomingPayments(pk, c, assets),
    getBalances: (pk: string, assets?: string[]) => getBalances(pk, assets),
    establishTrustline: (i: unknown) => establishTrustline(i),
  },
}));

// In-memory Redis stub for the cursor.
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock("@/server/redis", () => ({
  redis: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    }),
  },
}));

import { syncWalletDeposits } from "./deposit-poller";

const USDT_ISSUER = "GISSUERUSDT";

describe("syncWalletDeposits", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    store.clear();
    await resetDb();
  });

  afterEach(() => {
    delete process.env.PAYMENT_ASSETS;
    delete process.env.USDT_ASSET_ISSUER;
  });

  it("credits a new deposit exactly once (idempotent by stellarTxHash)", async () => {
    const { wallet } = await makePayer({ cachedXlm: "0.0000000" });
    listIncomingPayments.mockResolvedValue({
      items: [
        {
          id: "op1",
          asset: "XLM",
          amount: dec("25"),
          from: "GSENDER",
          txHash: "DEPOSITHASH1",
          createdAt: new Date(),
        },
      ],
      cursor: "cursor-1",
    });

    const first = await syncWalletDeposits(wallet.id);
    expect(first.newDeposits).toBe(1);
    expect(first.balanceXlm.toFixed(7)).toBe("25.0000000");

    // Second run returns the same payment again → must NOT double-credit.
    const second = await syncWalletDeposits(wallet.id);
    expect(second.newDeposits).toBe(0);

    const txs = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "PREFUND_DEPOSIT" },
    });
    expect(txs).toHaveLength(1);
    expect(txs[0]!.amount.toFixed(7)).toBe("25.0000000");
    expect(txs[0]!.asset).toBe("XLM");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.cachedXlmBalance.toFixed(7)).toBe("25.0000000");
    expect(w.lastSyncedAt).not.toBeNull();
  });

  it("passes the persisted cursor on subsequent calls", async () => {
    const { wallet } = await makePayer();
    listIncomingPayments.mockResolvedValue({ items: [], cursor: "cursor-9" });
    await syncWalletDeposits(wallet.id);
    await syncWalletDeposits(wallet.id);
    expect(listIncomingPayments).toHaveBeenLastCalledWith(wallet.stellarPublicKey, "cursor-9", [
      "XLM",
    ]);
  });

  it("skips Horizon balance reads when only XLM is enabled", async () => {
    const { wallet } = await makePayer();
    listIncomingPayments.mockResolvedValue({ items: [], cursor: "c" });
    await syncWalletDeposits(wallet.id);
    expect(getBalances).not.toHaveBeenCalled();
  });

  it("credits an incoming USDT deposit to the USDT balance, not the XLM one", async () => {
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    process.env.USDT_ASSET_ISSUER = USDT_ISSUER;
    const { wallet } = await makePayer({ cachedXlm: "10.0000000" });
    listIncomingPayments.mockResolvedValue({
      items: [
        {
          id: "op2",
          asset: "USDT",
          amount: dec("42.5"),
          from: "GSENDER",
          txHash: "USDTHASH1",
          createdAt: new Date(),
        },
      ],
      cursor: "cursor-2",
    });
    getBalances.mockResolvedValue([{ asset: "USDT", balance: dec("42.5"), trustline: true }]);

    const res = await syncWalletDeposits(wallet.id);
    expect(res.newDeposits).toBe(1);
    expect(res.balances.USDT!.toFixed(7)).toBe("42.5000000");
    // XLM is untouched by a USDT deposit.
    expect(res.balanceXlm.toFixed(7)).toBe("10.0000000");

    const tx = await db.walletTransaction.findUniqueOrThrow({
      where: { stellarTxHash: "USDTHASH1" },
    });
    expect(tx.asset).toBe("USDT");
    expect(tx.amount.toFixed(7)).toBe("42.5000000");

    const row = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDT" } },
    });
    expect(row.cached.toFixed(7)).toBe("42.5000000");
    // Horizon reported a live trustline, so the wallet is marked able to receive.
    expect(row.trustlineEstablishedAt).not.toBeNull();
  });

  it("adds a missing trustline itself once the wallet holds enough XLM", async () => {
    // Stellar requires a trustline before an issued asset can arrive. A custodial
    // wallet can add it on the payer's behalf, so they never see the step.
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    process.env.USDT_ASSET_ISSUER = USDT_ISSUER;
    const { wallet } = await makePayer({ cachedXlm: "5.0000000" });
    listIncomingPayments.mockResolvedValue({ items: [], cursor: "c" });
    getBalances.mockResolvedValue([{ asset: "USDT", balance: dec("0"), trustline: false }]);
    establishTrustline.mockResolvedValue({ txHash: "T1", alreadyEstablished: false });

    await syncWalletDeposits(wallet.id);

    expect(establishTrustline.mock.calls[0]![0]).toMatchObject({ asset: "USDT" });
    const row = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDT" } },
    });
    expect(row.trustlineEstablishedAt).not.toBeNull();
  });

  it("waits to add a trustline until the wallet can cover the reserve", async () => {
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    process.env.USDT_ASSET_ISSUER = USDT_ISSUER;
    const { wallet } = await makePayer({ cachedXlm: "0.1000000" });
    listIncomingPayments.mockResolvedValue({ items: [], cursor: "c" });
    getBalances.mockResolvedValue([{ asset: "USDT", balance: dec("0"), trustline: false }]);

    await syncWalletDeposits(wallet.id);
    expect(establishTrustline).not.toHaveBeenCalled();
  });

  it("keeps syncing deposits when auto-trustline fails", async () => {
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    process.env.USDT_ASSET_ISSUER = USDT_ISSUER;
    const { wallet } = await makePayer({ cachedXlm: "5.0000000" });
    listIncomingPayments.mockResolvedValue({ items: [], cursor: "c" });
    getBalances.mockResolvedValue([{ asset: "USDT", balance: dec("0"), trustline: false }]);
    establishTrustline.mockRejectedValue(new Error("Stellar rejected the transaction"));

    await expect(syncWalletDeposits(wallet.id)).resolves.toMatchObject({ newDeposits: 0 });
  });

  it("ignores an asset that is not enabled", async () => {
    // Only XLM enabled → the poller asks Horizon for XLM only, so a USDT payment
    // never reaches it. Assert the filter it passes down rather than the record.
    const { wallet } = await makePayer();
    listIncomingPayments.mockResolvedValue({ items: [], cursor: "c" });
    await syncWalletDeposits(wallet.id);
    expect(listIncomingPayments).toHaveBeenCalledWith(wallet.stellarPublicKey, undefined, ["XLM"]);
  });
});
