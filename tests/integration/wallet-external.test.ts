import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { Keypair } from "@stellar/stellar-sdk";
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

// What the connected account holds on the chain.
const { getOwnWalletHoldings } = vi.hoisted(() => ({ getOwnWalletHoldings: vi.fn() }));
vi.mock("@/server/payer/holdings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/payer/holdings")>()),
  getOwnWalletHoldings: (account: string) => getOwnWalletHoldings(account),
}));

import { GET, PUT, PATCH, DELETE } from "@/app/api/wallet/external/route";
import { dec } from "@/lib/money";
import { getOwnWallet } from "@/server/wallet/external";

const noParams = { params: Promise.resolve({}) };
const sameOrigin = { origin: "http://localhost", "sec-fetch-site": "same-origin" };

function req(method: "PUT" | "PATCH" | "DELETE", body?: unknown) {
  return new NextRequest("http://localhost/api/wallet/external", {
    method,
    headers: { ...sameOrigin, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

describe("/api/wallet/external", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.NONCUSTODIAL_ENABLED = "true";
    sessionUser.current = null;
    await resetDb();
  });
  afterEach(() => {
    delete process.env.NONCUSTODIAL_ENABLED;
  });

  async function signIn() {
    const { user, wallet } = await makePayer();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    return { user, wallet };
  }

  it("stores the connected account and turns the payer's own wallet on", async () => {
    const { user } = await signIn();
    const own = Keypair.random().publicKey();

    const res = await PUT(req("PUT", { publicKey: own }), noParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ walletMode: "EXTERNAL", externalPublicKey: own });

    // What a reload of the settings page reads.
    expect(await getOwnWallet(user.id)).toEqual({ walletMode: "EXTERNAL", externalPublicKey: own });
    const log = await db.auditLog.findFirstOrThrow({ where: { actorId: user.id } });
    expect(log.action).toBe("wallet.external_connected");
  });

  it("keeps a new payer on the custodial wallet until they connect", async () => {
    const { user } = await signIn();
    expect(await getOwnWallet(user.id)).toEqual({
      walletMode: "CUSTODIAL",
      externalPublicKey: null,
    });
  });

  it("switches back to the custodial wallet and on again, keeping the account", async () => {
    const { user } = await signIn();
    const own = Keypair.random().publicKey();
    await PUT(req("PUT", { publicKey: own }), noParams);

    const off = await PATCH(req("PATCH", { walletMode: "CUSTODIAL" }), noParams);
    expect(await off.json()).toEqual({ walletMode: "CUSTODIAL", externalPublicKey: own });
    expect(await getOwnWallet(user.id)).toEqual({
      walletMode: "CUSTODIAL",
      externalPublicKey: own,
    });

    const on = await PATCH(req("PATCH", { walletMode: "EXTERNAL" }), noParams);
    expect(await on.json()).toEqual({ walletMode: "EXTERNAL", externalPublicKey: own });
  });

  it("refuses to turn the payer's own wallet on with none connected", async () => {
    const { user } = await signIn();
    const res = await PATCH(req("PATCH", { walletMode: "EXTERNAL" }), noParams);
    expect(res.status).toBe(409);
    expect((await getOwnWallet(user.id)).walletMode).toBe("CUSTODIAL");
  });

  it("disconnects: forgets the account and returns to the custodial wallet", async () => {
    const { user } = await signIn();
    await PUT(req("PUT", { publicKey: Keypair.random().publicKey() }), noParams);

    const res = await DELETE(req("DELETE"), noParams);
    expect(await res.json()).toEqual({ walletMode: "CUSTODIAL", externalPublicKey: null });
    expect(await getOwnWallet(user.id)).toEqual({
      walletMode: "CUSTODIAL",
      externalPublicKey: null,
    });
  });

  it("refuses anything that is not a Stellar account address", async () => {
    const { user } = await signIn();
    for (const publicKey of ["GNOTAKEY", Keypair.random().secret(), ""]) {
      const res = await PUT(req("PUT", { publicKey }), noParams);
      expect(res.status).toBe(400);
    }
    expect((await getOwnWallet(user.id)).externalPublicKey).toBeNull();
  });

  it("refuses an account HeyPay holds the key to", async () => {
    const { user, wallet } = await signIn();
    const custodial = Keypair.random().publicKey();
    await db.custodialWallet.update({
      where: { id: wallet.id },
      data: { stellarPublicKey: custodial },
    });

    const res = await PUT(req("PUT", { publicKey: custodial }), noParams);
    expect(res.status).toBe(409);
    expect((await getOwnWallet(user.id)).externalPublicKey).toBeNull();
  });

  it("answers 404 and stores nothing while the feature is off", async () => {
    const { user } = await signIn();
    process.env.NONCUSTODIAL_ENABLED = "false";
    const own = Keypair.random().publicKey();

    expect((await PUT(req("PUT", { publicKey: own }), noParams)).status).toBe(404);
    expect((await PATCH(req("PATCH", { walletMode: "EXTERNAL" }), noParams)).status).toBe(404);
    expect((await DELETE(req("DELETE"), noParams)).status).toBe(404);
    expect((await getOwnWallet(user.id)).externalPublicKey).toBeNull();
  });

  it("needs a signed-in payer", async () => {
    const res = await PUT(req("PUT", { publicKey: Keypair.random().publicKey() }), noParams);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/wallet/external", () => {
  const read = () => GET(new NextRequest("http://localhost/api/wallet/external"), noParams);

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.NONCUSTODIAL_ENABLED = "true";
    sessionUser.current = null;
    getOwnWalletHoldings.mockReset();
    await resetDb();
  });
  afterEach(() => {
    delete process.env.NONCUSTODIAL_ENABLED;
  });

  async function signIn(externalPublicKey: string | null, walletMode: "CUSTODIAL" | "EXTERNAL") {
    const { user } = await makePayer();
    await db.user.update({ where: { id: user.id }, data: { externalPublicKey, walletMode } });
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
  }

  it("says what the connected account holds, read from the chain", async () => {
    const own = Keypair.random().publicKey();
    await signIn(own, "EXTERNAL");
    getOwnWalletHoldings.mockResolvedValue({
      publicKey: own,
      totalPhp: dec("1200"),
      hasUnpricedBalance: false,
      tokens: [
        {
          asset: "XLM",
          balance: dec("100"),
          reserved: dec("1.7000100"),
          available: dec("98.2999900"),
          rate: dec("12"),
          valuePhp: dec("1200"),
          canReceive: true,
        },
      ],
    });

    const res = await read();

    expect(res.status).toBe(200);
    expect(getOwnWalletHoldings).toHaveBeenCalledWith(own);
    expect(await res.json()).toEqual({
      walletMode: "EXTERNAL",
      externalPublicKey: own,
      readable: true,
      holdings: {
        totalPhp: "1200.00",
        hasUnpricedBalance: false,
        tokens: [
          {
            asset: "XLM",
            balance: "100.0000000",
            available: "98.2999900",
            valuePhp: "1200.00",
            rate: "12.00000000",
            canReceive: true,
          },
        ],
      },
    });
  });

  it("still reads a connected account while the HeyPay wallet pays", async () => {
    const own = Keypair.random().publicKey();
    await signIn(own, "CUSTODIAL");
    getOwnWalletHoldings.mockResolvedValue({
      publicKey: own,
      totalPhp: dec("0"),
      hasUnpricedBalance: false,
      tokens: [],
    });
    const res = await read();
    expect(await res.json()).toMatchObject({ walletMode: "CUSTODIAL", readable: true });
  });

  it("reads nothing when no account is connected", async () => {
    await signIn(null, "CUSTODIAL");
    const res = await read();
    expect(await res.json()).toEqual({
      walletMode: "CUSTODIAL",
      externalPublicKey: null,
      holdings: null,
      readable: true,
    });
    expect(getOwnWalletHoldings).not.toHaveBeenCalled();
  });

  it("says the chain could not be read instead of showing an empty wallet", async () => {
    await signIn(Keypair.random().publicKey(), "EXTERNAL");
    getOwnWalletHoldings.mockRejectedValue(new Error("Horizon down"));
    const res = await read();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ holdings: null, readable: false });
  });

  it("answers 404 while the feature is off, and 401 without a session", async () => {
    await signIn(Keypair.random().publicKey(), "EXTERNAL");
    process.env.NONCUSTODIAL_ENABLED = "false";
    expect((await read()).status).toBe(404);

    process.env.NONCUSTODIAL_ENABLED = "true";
    sessionUser.current = null;
    expect((await read()).status).toBe(401);
  });
});
