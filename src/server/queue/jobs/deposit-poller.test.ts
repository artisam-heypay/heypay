import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer } from "../../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";

const { listIncomingPayments } = vi.hoisted(() => ({ listIncomingPayments: vi.fn() }));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: { listIncomingPayments: (pk: string, c?: string) => listIncomingPayments(pk, c) },
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

describe("syncWalletDeposits", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    store.clear();
    await resetDb();
  });

  it("credits a new deposit exactly once (idempotent by stellarTxHash)", async () => {
    const { wallet } = await makePayer({ cachedXlm: "0.0000000" });
    listIncomingPayments.mockResolvedValue({
      items: [
        {
          id: "op1",
          amountXlm: dec("25"),
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
    expect(txs[0]!.amountXlm.toFixed(7)).toBe("25.0000000");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.cachedXlmBalance.toFixed(7)).toBe("25.0000000");
    expect(w.lastSyncedAt).not.toBeNull();
  });

  it("passes the persisted cursor on subsequent calls", async () => {
    const { wallet } = await makePayer();
    listIncomingPayments.mockResolvedValue({ items: [], cursor: "cursor-9" });
    await syncWalletDeposits(wallet.id);
    await syncWalletDeposits(wallet.id);
    expect(listIncomingPayments).toHaveBeenLastCalledWith(wallet.stellarPublicKey, "cursor-9");
  });
});
