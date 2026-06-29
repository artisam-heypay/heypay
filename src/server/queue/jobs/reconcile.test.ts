import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer } from "../../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";

const { getBalance } = vi.hoisted(() => ({ getBalance: vi.fn() }));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: { getBalance: (pk: string) => getBalance(pk) },
}));

import { processReconcileJob } from "./reconcile";

describe("processReconcileJob", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
  });

  it("flags drift between cached balance and Horizon to AuditLog", async () => {
    const { wallet } = await makePayer({ cachedXlm: "10.0000000" });
    getBalance.mockResolvedValue(dec("9")); // Horizon says 9, cache says 10 → drift

    const res = await processReconcileJob();
    expect(res.checked).toBe(1);
    expect(res.drift).toBe(1);

    const logs = await db.auditLog.findMany({
      where: { action: "reconcile.drift", target: wallet.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata).toMatchObject({ cachedXlm: "10.0000000", horizonXlm: "9.0000000" });
  });

  it("records no drift when balances match", async () => {
    await makePayer({ cachedXlm: "10.0000000" });
    getBalance.mockResolvedValue(dec("10"));
    const res = await processReconcileJob();
    expect(res.drift).toBe(0);
    expect(await db.auditLog.count({ where: { action: "reconcile.drift" } })).toBe(0);
  });
});
