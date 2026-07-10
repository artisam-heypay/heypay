import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, makePayer } from "../helpers/db";
import { db } from "@/server/db";

const { sessionUser } = vi.hoisted(() => ({
  sessionUser: {
    current: null as null | { id: string; username: string; role: "PAYER"; isActive: boolean },
  },
}));
vi.mock("@/server/auth/sessions", () => ({
  requireRole: vi.fn(async () => {
    if (!sessionUser.current) {
      const { AppError } = await import("@/lib/errors");
      throw new AppError("UNAUTHORIZED", "no session", 401);
    }
    return sessionUser.current;
  }),
}));
vi.mock("@/server/auth/rate-limit", () => ({ rateLimit: vi.fn(async () => {}) }));

const { establishTrustline } = vi.hoisted(() => ({ establishTrustline: vi.fn() }));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: { establishTrustline: (i: unknown) => establishTrustline(i) },
}));

import { POST as postTrustline } from "@/app/api/wallet/trustline/route";

const noParams = { params: Promise.resolve({}) };
const sameOrigin = { origin: "http://localhost", "sec-fetch-site": "same-origin" };

function req(body: unknown) {
  return new NextRequest("http://localhost/api/wallet/trustline", {
    method: "POST",
    headers: { ...sameOrigin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/wallet/trustline", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    process.env.USDT_ASSET_ISSUER = "GISSUERUSDT";
    establishTrustline.mockResolvedValue({ txHash: "TRUSTHASH", alreadyEstablished: false });
    await resetDb();
  });
  afterEach(() => {
    delete process.env.PAYMENT_ASSETS;
    delete process.env.USDT_ASSET_ISSUER;
  });

  async function signIn(opts?: Parameters<typeof makePayer>[0]) {
    const { user, wallet } = await makePayer(opts);
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    return { user, wallet };
  }

  it("establishes a USDT trustline and records it on the wallet balance", async () => {
    const { wallet } = await signIn({ cachedXlm: "5.0000000" });
    const res = await postTrustline(req({ asset: "USDT" }), noParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      asset: "USDT",
      txHash: "TRUSTHASH",
      canReceive: true,
    });
    expect(establishTrustline.mock.calls[0]![0]).toMatchObject({ asset: "USDT" });

    const row = await db.walletBalance.findUniqueOrThrow({
      where: { walletId_asset: { walletId: wallet.id, asset: "USDT" } },
    });
    expect(row.trustlineEstablishedAt).not.toBeNull();
  });

  it("is idempotent when the trustline already exists on-chain", async () => {
    establishTrustline.mockResolvedValue({ txHash: null, alreadyEstablished: true });
    await signIn({ cachedXlm: "5.0000000" });
    const res = await postTrustline(req({ asset: "USDT" }), noParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ alreadyEstablished: true, txHash: null });
  });

  it("refuses when the wallet cannot cover the extra base reserve", async () => {
    // Each trustline raises the account's minimum XLM reserve by 0.5 XLM.
    await signIn({ cachedXlm: "0.1000000" });
    const res = await postTrustline(req({ asset: "USDT" }), noParams);
    expect(res.status).toBe(409);
    expect(establishTrustline).not.toHaveBeenCalled();
  });

  it("refuses XLM, which needs no trustline", async () => {
    await signIn({ cachedXlm: "5.0000000" });
    const res = await postTrustline(req({ asset: "XLM" }), noParams);
    expect(res.status).toBe(400);
    expect(establishTrustline).not.toHaveBeenCalled();
  });

  it("refuses an asset that PAYMENT_ASSETS does not enable", async () => {
    process.env.PAYMENT_ASSETS = "XLM";
    await signIn({ cachedXlm: "5.0000000" });
    const res = await postTrustline(req({ asset: "USDT" }), noParams);
    expect(res.status).toBe(400);
    expect(establishTrustline).not.toHaveBeenCalled();
  });

  it("counts reserved XLM as unavailable for the reserve check", async () => {
    // 1.2 cached but 1.0 held by an in-flight payment → only 0.2 available.
    await signIn({ cachedXlm: "1.2000000", reservedXlm: "1.0000000" });
    const res = await postTrustline(req({ asset: "USDT" }), noParams);
    expect(res.status).toBe(409);
  });
});
