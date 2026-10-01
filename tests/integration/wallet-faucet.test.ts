import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { Networks } from "@stellar/stellar-sdk";
import { resetDb, makePayer } from "../helpers/db";
import { db } from "@/server/db";
import { encryptSecret } from "@/server/crypto/envelope";

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

const { fundXlm, syncWalletDeposits } = vi.hoisted(() => ({
  fundXlm: vi.fn(),
  syncWalletDeposits: vi.fn(),
}));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: { fundXlm: (i: unknown) => fundXlm(i) },
}));
vi.mock("@/server/queue/jobs/deposit-poller", () => ({
  syncWalletDeposits: (id: string) => syncWalletDeposits(id),
}));

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn(() => "event-id") }));
vi.mock("@/server/observability/error-tracking", async (original) => ({
  ...(await original<typeof import("@/server/observability/error-tracking")>()),
  captureException,
}));

import { POST as postFaucet } from "@/app/api/wallet/faucet/route";
import { getFaucetStatus } from "@/server/payer/faucet";

const noParams = { params: Promise.resolve({}) };
const sameOrigin = { origin: "http://localhost", "sec-fetch-site": "same-origin" };
const req = () =>
  new NextRequest("http://localhost/api/wallet/faucet", { method: "POST", headers: sameOrigin });

describe("POST /api/wallet/faucet", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.FAUCET_SECRET_ENC = encryptSecret("SFAUCETSECRET");
    delete process.env.FAUCET_AMOUNT_XLM;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
    process.env.STELLAR_NETWORK = "testnet";
    fundXlm.mockResolvedValue({ txHash: "FAUCETHASH", created: true });
    syncWalletDeposits.mockResolvedValue({ balanceXlm: 0, balances: {}, newDeposits: 1 });
    await resetDb();
  });
  afterEach(() => {
    delete process.env.FAUCET_SECRET_ENC;
    delete process.env.FAUCET_AMOUNT_XLM;
    delete process.env.STELLAR_NETWORK;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
  });

  async function signIn() {
    const { user, wallet } = await makePayer({ cachedXlm: "0.0000000" });
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    return { user, wallet };
  }

  it("sends 20 XLM from the faucet account to the payer's wallet", async () => {
    const { user, wallet } = await signIn();
    const res = await postFaucet(req(), noParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      amountXlm: "20.0000000",
      txHash: "FAUCETHASH",
      txUrl: expect.stringContaining("/testnet/tx/FAUCETHASH"),
    });
    const call = fundXlm.mock.calls[0]![0] as {
      destination: string;
      amountXlm: { toFixed(n: number): string };
      encryptedSecret: string;
    };
    expect(call.destination).toBe(wallet.stellarPublicKey);
    expect(call.amountXlm.toFixed(7)).toBe("20.0000000");
    expect(call.encryptedSecret).toBe(process.env.FAUCET_SECRET_ENC);
    expect(syncWalletDeposits).toHaveBeenCalledWith(wallet.id);

    const claim = await db.faucetClaim.findUniqueOrThrow({ where: { userId: user.id } });
    expect(claim.status).toBe("SENT");
    expect(claim.txHash).toBe("FAUCETHASH");
    expect(await getFaucetStatus(user.id)).toMatchObject({ enabled: true, claimed: true });
  });

  it("allows only one claim per payer", async () => {
    await signIn();
    expect((await postFaucet(req(), noParams)).status).toBe(200);
    const again = await postFaucet(req(), noParams);
    expect(again.status).toBe(409);
    expect(fundXlm).toHaveBeenCalledTimes(1);
  });

  it("sends once when two claims race", async () => {
    await signIn();
    const results = await Promise.all([postFaucet(req(), noParams), postFaucet(req(), noParams)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(fundXlm).toHaveBeenCalledTimes(1);
  });

  it("lets the payer retry after the send fails", async () => {
    const { user } = await signIn();
    fundXlm.mockRejectedValueOnce(new Error("op_underfunded"));
    const failed = await postFaucet(req(), noParams);
    expect(failed.status).toBe(503);
    expect((await db.faucetClaim.findUniqueOrThrow({ where: { userId: user.id } })).status).toBe(
      "FAILED",
    );
    expect(await getFaucetStatus(user.id)).toMatchObject({ claimed: false });

    const retried = await postFaucet(req(), noParams);
    expect(retried.status).toBe(200);
    expect(fundXlm).toHaveBeenCalledTimes(2);
  });

  it("still succeeds when the immediate deposit sync fails", async () => {
    await signIn();
    syncWalletDeposits.mockRejectedValueOnce(new Error("horizon down"));
    expect((await postFaucet(req(), noParams)).status).toBe(200);
  });

  it("honours FAUCET_AMOUNT_XLM", async () => {
    process.env.FAUCET_AMOUNT_XLM = "5";
    await signIn();
    const res = await postFaucet(req(), noParams);
    expect(await res.json()).toMatchObject({ amountXlm: "5.0000000" });
  });

  it("is off when no faucet account is configured", async () => {
    delete process.env.FAUCET_SECRET_ENC;
    const { user } = await signIn();
    expect((await postFaucet(req(), noParams)).status).toBe(404);
    expect(fundXlm).not.toHaveBeenCalled();
    expect(await getFaucetStatus(user.id)).toEqual({ enabled: false });
  });

  it("is off on mainnet even with a faucet account configured", async () => {
    process.env.STELLAR_NETWORK = "mainnet";
    await signIn();
    expect((await postFaucet(req(), noParams)).status).toBe(404);
    expect(fundXlm).not.toHaveBeenCalled();
  });

  it("is off on mainnet when only the passphrase says so", async () => {
    process.env.STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    const { user } = await signIn();
    expect((await postFaucet(req(), noParams)).status).toBe(404);
    expect(await getFaucetStatus(user.id)).toEqual({ enabled: false });
  });

  it.each(["abc", "0", "-5", "1.12345678"])(
    "is off, and reports it once, when FAUCET_AMOUNT_XLM is %s",
    async (amount) => {
      process.env.FAUCET_AMOUNT_XLM = amount;
      const { user } = await signIn();
      expect(await getFaucetStatus(user.id)).toEqual({ enabled: false });
      expect((await postFaucet(req(), noParams)).status).toBe(404);
      expect(fundXlm).not.toHaveBeenCalled();
      expect(captureException).toHaveBeenCalledTimes(1);
    },
  );

  it("requires a signed-in payer", async () => {
    sessionUser.current = null;
    expect((await postFaucet(req(), noParams)).status).toBe(401);
  });
});
