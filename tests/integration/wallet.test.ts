import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, makePayer } from "../helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";

const { sessionUser } = vi.hoisted(() => ({
  sessionUser: {
    current: null as null | { id: string; username: string; role: "PAYER"; isActive: boolean },
  },
}));
vi.mock("@/server/auth/sessions", () => ({
  requireUser: vi.fn(async () => {
    if (!sessionUser.current) {
      const { AppError } = await import("@/lib/errors");
      throw new AppError("UNAUTHORIZED", "no session", 401);
    }
    return sessionUser.current;
  }),
}));
vi.mock("@/server/rails", () => ({
  rail: {
    getQuote: vi.fn(async () => ({
      rate: dec("12"),
      phpAmount: dec("0"),
      xlmAmount: dec("0"),
      expiresAt: new Date(),
    })),
  },
}));
const { syncWalletDeposits } = vi.hoisted(() => ({ syncWalletDeposits: vi.fn() }));
vi.mock("@/server/queue/jobs/deposit-poller", () => ({
  syncWalletDeposits: (id: string) => syncWalletDeposits(id),
}));

import { GET as getWallet } from "@/app/api/wallet/route";
import { POST as postSync } from "@/app/api/wallet/sync/route";
import { GET as getTxns } from "@/app/api/wallet/transactions/route";

const noParams = { params: Promise.resolve({}) };

describe("wallet API", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sessionUser.current = null;
    syncWalletDeposits.mockResolvedValue({ balanceXlm: dec("42"), newDeposits: 1 });
    await resetDb();
  });

  it("GET /api/wallet returns balance, reserved, available and approxPhp", async () => {
    const { user, wallet } = await makePayer({ cachedXlm: "10.0000000", reservedXlm: "2.0000000" });
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    const res = await getWallet(new NextRequest("http://localhost/api/wallet"), noParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      publicKey: wallet.stellarPublicKey,
      balanceXlm: "10.0000000",
      reservedXlm: "2.0000000",
      availableXlm: "8.0000000",
    });
  });

  it("POST /api/wallet/sync reconciles via syncWalletDeposits", async () => {
    const { user } = await makePayer();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    const req = new NextRequest("http://localhost/api/wallet/sync", {
      method: "POST",
      headers: { origin: "http://localhost", "sec-fetch-site": "same-origin" },
    });
    const res = await postSync(req, noParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ balanceXlm: "42.0000000" });
    expect(syncWalletDeposits).toHaveBeenCalledOnce();
  });

  it("GET /api/wallet/transactions paginates by cursor", async () => {
    const { user, wallet } = await makePayer();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    for (let i = 0; i < 3; i++) {
      await db.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "PREFUND_DEPOSIT",
          amountXlm: "1.0000000",
          balanceAfter: `${i + 1}.0000000`,
          stellarTxHash: `H${i}`,
        },
      });
    }
    const res = await getTxns(
      new NextRequest("http://localhost/api/wallet/transactions?limit=2"),
      noParams,
    );
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeTruthy();
    const res2 = await getTxns(
      new NextRequest(`http://localhost/api/wallet/transactions?limit=2&cursor=${body.nextCursor}`),
      noParams,
    );
    const body2 = await res2.json();
    expect(body2.items).toHaveLength(1);
    expect(body2.nextCursor).toBeNull();
  });
});
