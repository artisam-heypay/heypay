import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDb, makePayer } from "../../../../tests/helpers/db";
import { db } from "@/server/db";

const { activateSponsored } = vi.hoisted(() => ({ activateSponsored: vi.fn() }));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: { activateSponsored: (i: unknown) => activateSponsored(i) },
}));

import { processWalletActivateJob } from "./wallet-activate";

describe("processWalletActivateJob", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
    process.env.WALLET_SPONSOR_SECRET_ENC = "v1:sponsor";
    process.env.PAYMENT_ASSETS = "XLM,USDC";
  });

  afterEach(() => {
    delete process.env.WALLET_SPONSOR_SECRET_ENC;
    delete process.env.PAYMENT_ASSETS;
  });

  const usdcRow = (walletId: string) =>
    db.walletBalance.findUnique({ where: { walletId_asset: { walletId, asset: "USDC" } } });

  it("activates the wallet and records the trustline with its transaction", async () => {
    const { user, wallet } = await makePayer({ cachedXlm: "0.0000000" });
    activateSponsored.mockResolvedValue({
      txHash: "SPONSORTX",
      created: true,
      trustlines: ["USDC"],
    });

    await processWalletActivateJob({ data: { userId: user.id } });

    expect(activateSponsored).toHaveBeenCalledWith({
      sponsorEncryptedSecret: "v1:sponsor",
      encryptedSecret: wallet.encryptedSecret,
      assets: ["USDC"],
    });
    const row = await usdcRow(wallet.id);
    expect(row?.trustlineEstablishedAt).not.toBeNull();
    expect(row?.trustlineTxHash).toBe("SPONSORTX");
    // The sponsor's reserve is not the payer's: no balance, no ledger entry.
    const after = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.cachedXlmBalance.toFixed(7)).toBe("0.0000000");
    expect(await db.walletTransaction.count({ where: { walletId: wallet.id } })).toBe(0);
    const log = await db.auditLog.findFirst({ where: { action: "wallet.activate.sponsored" } });
    expect(log?.target).toBe(wallet.id);
  });

  it("marks a trustline that was already there, without a transaction", async () => {
    const { user, wallet } = await makePayer();
    activateSponsored.mockResolvedValue({ txHash: null, created: false, trustlines: [] });

    await processWalletActivateJob({ data: { userId: user.id } });

    const row = await usdcRow(wallet.id);
    expect(row?.trustlineEstablishedAt).not.toBeNull();
    expect(row?.trustlineTxHash).toBeNull();
    expect(await db.auditLog.count({ where: { action: "wallet.activate.sponsored" } })).toBe(0);
  });

  it("does nothing without a sponsor account", async () => {
    delete process.env.WALLET_SPONSOR_SECRET_ENC;
    const { user, wallet } = await makePayer();

    await processWalletActivateJob({ data: { userId: user.id } });

    expect(activateSponsored).not.toHaveBeenCalled();
    expect(await usdcRow(wallet.id)).toBeNull();
  });

  it("does nothing when only XLM is enabled", async () => {
    process.env.PAYMENT_ASSETS = "XLM";
    const { user } = await makePayer();
    await processWalletActivateJob({ data: { userId: user.id } });
    expect(activateSponsored).not.toHaveBeenCalled();
  });

  it("does nothing for a user with no wallet", async () => {
    await processWalletActivateJob({ data: { userId: "nobody" } });
    expect(activateSponsored).not.toHaveBeenCalled();
  });

  it("lets a refused transaction fail the job, so the queue retries it", async () => {
    const { user, wallet } = await makePayer();
    activateSponsored.mockRejectedValue(new Error("Stellar rejected the transaction"));

    await expect(processWalletActivateJob({ data: { userId: user.id } })).rejects.toThrow(
      "Stellar rejected",
    );
    expect(await usdcRow(wallet.id)).toBeNull();
  });
});
