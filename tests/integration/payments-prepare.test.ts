import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  Account,
  Address,
  Keypair,
  SorobanDataBuilder,
  TransactionBuilder,
  scValToNative,
  xdr,
  type Transaction,
  type rpc,
} from "@stellar/stellar-sdk";
import { resetDb, makePayer, makeMerchant } from "../helpers/db";
import { db } from "@/server/db";
import { newPaymentReference } from "@/server/payments/reference";
import { buildEscrowDeposit, type EscrowDepositInstructions } from "@/lib/client/escrow-deposit";
import type { PaymentStatus } from "@/generated/prisma/client";

const PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT_ID = "CDGIYVERJJ7JWIZBHNV3BYGKFOFHNTRAS4XW4KKV4ROTWQAGENI3LE5E";
const RPC_URL = "https://rpc.test";

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

const { canReceive } = vi.hoisted(() => ({ canReceive: vi.fn() }));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: { canReceive: (key: string, asset: string) => canReceive(key, asset) },
}));

const { holdsAsset } = vi.hoisted(() => ({ holdsAsset: vi.fn() }));
vi.mock("@/server/stellar/escrow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/stellar/escrow")>()),
  escrowHoldsAsset: (asset: string) => holdsAsset(asset),
}));

import { POST as prepare } from "@/app/api/payments/[id]/prepare/route";
import { escrowJobId } from "@/server/stellar/escrow";

const sameOrigin = { origin: "http://localhost", "sec-fetch-site": "same-origin" };

function post(paymentId: string) {
  return prepare(
    new NextRequest(`http://localhost/api/payments/${paymentId}/prepare`, {
      method: "POST",
      headers: sameOrigin,
    }),
    { params: Promise.resolve({ id: paymentId }) },
  );
}

/** A payer who connected their own wallet, with a payment waiting to be paid. */
async function makeQuoted(opts?: {
  status?: PaymentStatus;
  walletMode?: "CUSTODIAL" | "EXTERNAL";
  quoteExpiresInMs?: number;
}) {
  const own = Keypair.random().publicKey();
  const { user } = await makePayer();
  await db.user.update({
    where: { id: user.id },
    data: { externalPublicKey: own, walletMode: opts?.walletMode ?? "EXTERNAL" },
  });
  const { merchant } = await makeMerchant();
  const payment = await db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: "100.00",
      quotedRate: "12.00000000",
      amountAsset: "8.3333334",
      networkFeeXlm: "0.0000100",
      status: opts?.status ?? "QUOTED",
      quoteExpiresAt: new Date(Date.now() + (opts?.quoteExpiresInMs ?? 60_000)),
    },
  });
  sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
  return { user, own, payment };
}

async function refusal(res: Response): Promise<string> {
  return ((await res.json()) as { error: { message: string } }).error.message;
}

describe("POST /api/payments/[id]/prepare", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.NONCUSTODIAL_ENABLED = "true";
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID = CONTRACT_ID;
    process.env.SOROBAN_RPC_URL = RPC_URL;
    sessionUser.current = null;
    canReceive.mockReset().mockResolvedValue(true);
    holdsAsset.mockReset().mockResolvedValue(true);
    await resetDb();
  });
  afterEach(() => {
    delete process.env.NONCUSTODIAL_ENABLED;
    delete process.env.ESCROW_ENABLED;
    delete process.env.ESCROW_CONTRACT_ID;
    delete process.env.SOROBAN_RPC_URL;
  });

  it("says what the deposit for this payment must be, and builds nothing itself", async () => {
    const { own, payment } = await makeQuoted();

    const res = await post(payment.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as EscrowDepositInstructions;
    expect(body).toEqual({
      paymentId: payment.id,
      contractId: CONTRACT_ID,
      jobId: escrowJobId(payment.id).toString("hex"),
      from: own,
      amount: "83333334", // the quoted 8.3333334, in stroops
      networkPassphrase: PASSPHRASE,
      rpcUrl: RPC_URL,
      validUntil: expect.any(String),
    });

    // Preparing confirms nothing and marks nothing.
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("QUOTED");
    expect(after.escrowJobId).toBeNull();
    expect(after.stellarTxHash).toBeNull();
  });

  it("gives the payer's browser what it needs to build that deposit for their wallet", async () => {
    const { own, payment } = await makeQuoted();
    const body = (await (await post(payment.id)).json()) as EscrowDepositInstructions;

    // The browser's half, on a fake RPC server.
    const server = {
      getAccount: vi.fn(async (key: string) => new Account(key, "41")),
      simulateTransaction: vi.fn().mockResolvedValue({
        _parsed: true,
        id: "1",
        latestLedger: 100,
        events: [],
        minResourceFee: "100",
        transactionData: new SorobanDataBuilder(),
        result: { auth: [], retval: xdr.ScVal.scvVoid() },
      }),
    };
    const built = await buildEscrowDeposit(body, { server: server as unknown as rpc.Server });

    const tx = TransactionBuilder.fromXDR(built.xdr, PASSPHRASE) as Transaction;
    // The payer's to sign: their account is the source, and it is unsigned.
    expect(tx.source).toBe(own);
    expect(tx.signatures).toHaveLength(0);
    // deposit(jobId, payer, amount) for exactly this payment and its quoted amount.
    const call = (tx.operations[0] as { func: xdr.HostFunction }).func.invokeContract();
    const args = call.args().map((a) => scValToNative(a));
    expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(CONTRACT_ID);
    expect(call.functionName().toString()).toBe("deposit");
    expect(Buffer.from(args[0] as Uint8Array).equals(escrowJobId(payment.id))).toBe(true);
    expect(args[1]).toBe(own);
    expect(args[2]).toBe(83_333_334n);
    // And it dies with the quote.
    expect(Number(tx.timeBounds!.maxTime) * 1000).toBeLessThanOrEqual(
      payment.quoteExpiresAt!.getTime(),
    );
  });

  it("is never valid past the quote", async () => {
    const { payment } = await makeQuoted({ quoteExpiresInMs: 30_000 });
    const body = (await (await post(payment.id)).json()) as EscrowDepositInstructions;

    const validUntil = Date.parse(body.validUntil);
    expect(validUntil).toBeLessThanOrEqual(payment.quoteExpiresAt!.getTime());
    expect(validUntil).toBeGreaterThan(Date.now());
    expect(validUntil % 1000).toBe(0); // whole seconds, as the network counts them
  });

  it("is valid for two minutes at most, however long the quote lasts", async () => {
    const { payment } = await makeQuoted({ quoteExpiresInMs: 3_600_000 });
    const body = (await (await post(payment.id)).json()) as EscrowDepositInstructions;

    const secondsLeft = (Date.parse(body.validUntil) - Date.now()) / 1000;
    expect(secondsLeft).toBeLessThanOrEqual(120);
    expect(secondsLeft).toBeGreaterThan(110);
  });

  it("refuses a payer on the custodial wallet, saying which wallet pays", async () => {
    const { payment } = await makeQuoted({ walletMode: "CUSTODIAL" });
    const res = await post(payment.id);
    expect(res.status).toBe(409);
    // The reason lets a confirm screen drawn for their own wallet fall back.
    expect(await res.json()).toMatchObject({
      error: {
        message: "This payment is paid from your HeyPay wallet.",
        details: { reason: "heypay_wallet_pays" },
      },
    });
    expect(canReceive).not.toHaveBeenCalled();
  });

  it("refuses another payer's payment", async () => {
    const { payment } = await makeQuoted();
    const { user: other } = await makePayer();
    await db.user.update({
      where: { id: other.id },
      data: { externalPublicKey: Keypair.random().publicKey(), walletMode: "EXTERNAL" },
    });
    sessionUser.current = { id: other.id, username: other.username, role: "PAYER", isActive: true };

    expect((await post(payment.id)).status).toBe(403);
  });

  it("refuses an expired quote", async () => {
    const { payment } = await makeQuoted({ quoteExpiresInMs: -1_000 });
    expect((await post(payment.id)).status).toBe(409);
  });

  it("refuses a quote with under a second left rather than name a time already gone", async () => {
    const { payment } = await makeQuoted({ quoteExpiresInMs: 400 });
    const res = await post(payment.id);
    expect(res.status).toBe(409);
    expect(await refusal(res)).toBe("quote expired; please re-quote");
  });

  it("refuses a payment that is no longer a quote", async () => {
    const { payment } = await makeQuoted({ status: "AUTHORIZED" });
    expect((await post(payment.id)).status).toBe(409);
  });

  it("refuses when the payer's account is not on the network", async () => {
    const { payment } = await makeQuoted();
    canReceive.mockResolvedValue(false);

    const res = await post(payment.id);
    expect(res.status).toBe(409);
    expect(await refusal(res)).toContain("does not exist on Testnet");
  });

  it("refuses when no escrow holds the payment's asset", async () => {
    const { payment } = await makeQuoted();
    holdsAsset.mockResolvedValue(false);
    const wrongToken = await post(payment.id);
    expect(wrongToken.status).toBe(409);
    expect(await refusal(wrongToken)).toBe("HeyPay cannot hold XLM payments in escrow right now.");

    holdsAsset.mockResolvedValue(true);
    delete process.env.ESCROW_CONTRACT_ID;
    expect((await post(payment.id)).status).toBe(409);
  });

  it("answers 404 while the feature is off", async () => {
    const { payment } = await makeQuoted();
    process.env.NONCUSTODIAL_ENABLED = "false";
    expect((await post(payment.id)).status).toBe(404);
  });

  it("needs a signed-in payer", async () => {
    const { payment } = await makeQuoted();
    sessionUser.current = null;
    expect((await post(payment.id)).status).toBe(401);
  });
});
