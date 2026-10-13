import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  Account,
  Address,
  Contract,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  type Transaction,
} from "@stellar/stellar-sdk";
import { resetDb, makePayer, makeMerchant } from "../helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { newPaymentReference } from "@/server/payments/reference";
import type { PaymentStatus } from "@/generated/prisma/client";

const PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT_ID = "CDGIYVERJJ7JWIZBHNV3BYGKFOFHNTRAS4XW4KKV4ROTWQAGENI3LE5E";
const OTHER_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
// 8.3333334 XLM, the amount of every payment made here.
const AMOUNT_STROOPS = 83_333_334n;

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

// The network: what it answers to a transaction it is handed.
const { holdsAsset, sendSigned, getJob } = vi.hoisted(() => ({
  holdsAsset: vi.fn(),
  sendSigned: vi.fn(),
  getJob: vi.fn(),
}));
vi.mock("@/server/stellar/escrow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/stellar/escrow")>()),
  escrowHoldsAsset: (asset: string) => holdsAsset(asset),
  sendSignedTransaction: (tx: Transaction) => sendSigned(tx),
  // The contract: the job it holds for the payment, if any.
  escrowFor: () => ({ getJob: (jobId: Buffer) => getJob(jobId) }),
}));
vi.mock("@/server/stellar/wallet", () => ({ walletService: {} }));
vi.mock("@/server/rails", () => ({ fastSettleEnabled: () => false, rail: {} }));

const { enqueueSettle } = vi.hoisted(() => ({ enqueueSettle: vi.fn(async (_id: string) => {}) }));
vi.mock("@/server/queue/queues", () => ({ enqueueSettle }));

import { POST as signed } from "@/app/api/payments/[id]/signed/route";
import { escrowJobId } from "@/server/stellar/escrow";
import { confirmPayment } from "@/server/payments/confirm";

const sameOrigin = { origin: "http://localhost", "sec-fetch-site": "same-origin" };

function post(paymentId: string, body: unknown) {
  return signed(
    new NextRequest(`http://localhost/api/payments/${paymentId}/signed`, {
      method: "POST",
      headers: { ...sameOrigin, "content-type": "application/json" },
      body: JSON.stringify(body),
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
  const own = Keypair.random();
  const { user } = await makePayer();
  await db.user.update({
    where: { id: user.id },
    data: { externalPublicKey: own.publicKey(), walletMode: opts?.walletMode ?? "EXTERNAL" },
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

type DepositParts = {
  /** The account the transaction is from. */
  source: string;
  /** Who signs it; null leaves it unsigned. */
  signer: Keypair | null;
  contractId: string;
  fn: string;
  jobId: Buffer;
  from: string;
  amount: bigint;
  /** Seconds since the epoch; 0 never expires. */
  maxTime: number;
  passphrase: string;
};

/**
 * The escrow deposit a payer's browser builds and their wallet signs, as XDR.
 * `change` swaps out one part of it, the way a tampered one would differ.
 */
function signedDeposit(
  payment: { id: string },
  own: Keypair,
  change: Partial<DepositParts> = {},
): { xdr: string; hash: string } {
  const parts: DepositParts = {
    source: own.publicKey(),
    signer: own,
    contractId: CONTRACT_ID,
    fn: "deposit",
    jobId: escrowJobId(payment.id),
    from: own.publicKey(),
    amount: AMOUNT_STROOPS,
    maxTime: Math.floor(Date.now() / 1000) + 30,
    passphrase: PASSPHRASE,
    ...change,
  };
  const tx = new TransactionBuilder(new Account(parts.source, "41"), {
    fee: "100000",
    networkPassphrase: parts.passphrase,
    timebounds: { minTime: 0, maxTime: parts.maxTime },
  })
    .addOperation(
      new Contract(parts.contractId).call(
        parts.fn,
        nativeToScVal(parts.jobId, { type: "bytes" }),
        new Address(parts.from).toScVal(),
        nativeToScVal(parts.amount, { type: "i128" }),
      ),
    )
    .build();
  if (parts.signer) tx.sign(parts.signer);
  return { xdr: tx.toXDR(), hash: tx.hash().toString("hex") };
}

type ErrorBody = { error: { message: string; details?: { reason?: string; code?: string } } };

async function reason(res: Response): Promise<string | undefined> {
  return ((await res.json()) as ErrorBody).error.details?.reason;
}

/** Nothing was sent and the payment is still the quote it was. */
async function expectUntouched(paymentId: string) {
  expect(sendSigned).not.toHaveBeenCalled();
  expect(enqueueSettle).not.toHaveBeenCalled();
  const after = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  expect(after.status).toBe("QUOTED");
  expect(after.stellarTxHash).toBeNull();
  expect(after.escrowJobId).toBeNull();
  expect(after.externalPublicKey).toBeNull();
}

describe("POST /api/payments/[id]/signed", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.NONCUSTODIAL_ENABLED = "true";
    process.env.ESCROW_ENABLED = "true";
    process.env.ESCROW_CONTRACT_ID = CONTRACT_ID;
    delete process.env.ESCROW_TIMEOUT_LEDGERS;
    sessionUser.current = null;
    holdsAsset.mockReset().mockResolvedValue(true);
    sendSigned.mockReset().mockResolvedValue({ status: "accepted" });
    getJob.mockReset().mockResolvedValue(null);
    await resetDb();
  });
  afterEach(() => {
    delete process.env.NONCUSTODIAL_ENABLED;
    delete process.env.ESCROW_ENABLED;
    delete process.env.ESCROW_CONTRACT_ID;
  });

  it("takes the deposit the payer signed, records it, and hands it to the network as it came", async () => {
    const { own, payment } = await makeQuoted();
    const deposit = signedDeposit(payment, own);

    const res = await post(payment.id, { xdr: deposit.xdr });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      paymentId: payment.id,
      status: "AUTHORIZED",
      stellarTxHash: deposit.hash,
    });
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("AUTHORIZED");
    expect(after.stellarTxHash).toBe(deposit.hash);
    expect(after.escrowJobId).toBe(escrowJobId(payment.id).toString("hex"));
    expect(after.externalPublicKey).toBe(own.publicKey());
    // The very transaction the payer signed, signature and all.
    expect(sendSigned).toHaveBeenCalledTimes(1);
    expect((sendSigned.mock.calls[0]![0] as Transaction).toXDR()).toBe(deposit.xdr);
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
  });

  it("holds nothing in the payer's HeyPay wallet for it", async () => {
    const { user, own, payment } = await makeQuoted();
    const before = await db.custodialWallet.findUniqueOrThrow({ where: { userId: user.id } });

    await post(payment.id, { xdr: signedDeposit(payment, own).xdr });

    const after = await db.custodialWallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(after.reservedXlm.toString()).toBe(before.reservedXlm.toString());
    expect(after.cachedXlmBalance.toString()).toBe(before.cachedXlmBalance.toString());
    expect(await db.walletTransaction.count()).toBe(0);
  });

  describe("a transaction that is not the deposit for the payment", () => {
    const tampered: [string, (own: Keypair) => Partial<DepositParts>][] = [
      ["a different amount", () => ({ amount: AMOUNT_STROOPS - 1n })],
      ["a larger amount", () => ({ amount: AMOUNT_STROOPS * 10n })],
      ["a different destination contract", () => ({ contractId: OTHER_CONTRACT_ID })],
      ["a different contract function", () => ({ fn: "release" })],
      ["another payment's job id", () => ({ jobId: escrowJobId("some-other-payment") })],
      ["a deposit on behalf of another account", () => ({ from: Keypair.random().publicKey() })],
      ["a last valid second of 0, which never expires", () => ({ maxTime: 0 })],
      ["validity that outlasts the quote", () => ({ maxTime: Math.floor(Date.now() / 1000) + 90 })],
    ];
    it.each(tampered)("refuses %s", async (_name, change) => {
      const { own, payment } = await makeQuoted();
      const res = await post(payment.id, { xdr: signedDeposit(payment, own, change(own)).xdr });
      expect(res.status).toBe(400);
      expect(await reason(res)).toBe("not_the_deposit");
      await expectUntouched(payment.id);
    });

    it("refuses a different source account, even signed by that account", async () => {
      const { own, payment } = await makeQuoted();
      const other = Keypair.random();
      const res = await post(payment.id, {
        xdr: signedDeposit(payment, own, { source: other.publicKey(), signer: other }).xdr,
      });
      expect(res.status).toBe(400);
      expect(await reason(res)).toBe("not_the_deposit");
      await expectUntouched(payment.id);
    });

    it("refuses validity longer than a deposit can be given, however long the quote lasts", async () => {
      const { own, payment } = await makeQuoted({ quoteExpiresInMs: 10 * 60_000 });
      const res = await post(payment.id, {
        xdr: signedDeposit(payment, own, { maxTime: Math.floor(Date.now() / 1000) + 300 }).xdr,
      });
      expect(res.status).toBe(400);
      expect(await reason(res)).toBe("not_the_deposit");
      await expectUntouched(payment.id);
    });

    it("refuses a deposit with another operation riding along", async () => {
      const { own, payment } = await makeQuoted();
      const account = new Account(own.publicKey(), "41");
      const tx = new TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: PASSPHRASE,
        timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 30 },
      })
        .addOperation(
          new Contract(CONTRACT_ID).call(
            "deposit",
            nativeToScVal(escrowJobId(payment.id), { type: "bytes" }),
            new Address(own.publicKey()).toScVal(),
            nativeToScVal(AMOUNT_STROOPS, { type: "i128" }),
          ),
        )
        .addOperation(Operation.bumpSequence({ bumpTo: "100" }))
        .build();
      tx.sign(own);
      const res = await post(payment.id, { xdr: tx.toXDR() });
      expect(res.status).toBe(400);
      expect(await reason(res)).toBe("not_the_deposit");
      await expectUntouched(payment.id);
    });
  });

  describe("a deposit the payer's key did not sign", () => {
    it("refuses one with no signature", async () => {
      const { own, payment } = await makeQuoted();
      const res = await post(payment.id, {
        xdr: signedDeposit(payment, own, { signer: null }).xdr,
      });
      expect(res.status).toBe(400);
      expect(await reason(res)).toBe("not_signed");
      await expectUntouched(payment.id);
    });

    it("refuses one signed by another key", async () => {
      const { own, payment } = await makeQuoted();
      const res = await post(payment.id, {
        xdr: signedDeposit(payment, own, { signer: Keypair.random() }).xdr,
      });
      expect(res.status).toBe(400);
      expect(await reason(res)).toBe("not_signed");
      await expectUntouched(payment.id);
    });

    it("refuses one signed for another network", async () => {
      const { own, payment } = await makeQuoted();
      const res = await post(payment.id, {
        xdr: signedDeposit(payment, own, {
          passphrase: "Public Global Stellar Network ; September 2015",
        }).xdr,
      });
      expect(res.status).toBe(400);
      expect(await reason(res)).toBe("not_signed");
      await expectUntouched(payment.id);
    });
  });

  it("refuses a deposit whose validity has run out", async () => {
    const { own, payment } = await makeQuoted();
    const res = await post(payment.id, {
      xdr: signedDeposit(payment, own, { maxTime: Math.floor(Date.now() / 1000) - 1 }).xdr,
    });
    expect(res.status).toBe(400);
    expect(await reason(res)).toBe("expired");
    await expectUntouched(payment.id);
  });

  it("refuses what is not a transaction", async () => {
    const { payment } = await makeQuoted();
    const res = await post(payment.id, { xdr: "not-a-transaction" });
    expect(res.status).toBe(400);
    expect(await reason(res)).toBe("not_a_transaction");
    await expectUntouched(payment.id);
  });

  it("refuses the deposit wrapped in someone else's fee bump", async () => {
    const { own, payment } = await makeQuoted();
    const inner = TransactionBuilder.fromXDR(
      signedDeposit(payment, own).xdr,
      PASSPHRASE,
    ) as Transaction;
    const sponsor = Keypair.random();
    const bump = TransactionBuilder.buildFeeBumpTransaction(sponsor, "200000", inner, PASSPHRASE);
    bump.sign(sponsor);
    const res = await post(payment.id, { xdr: bump.toXDR() });
    expect(res.status).toBe(400);
    expect(await reason(res)).toBe("not_a_transaction");
    await expectUntouched(payment.id);
  });

  it("refuses a body without the transaction", async () => {
    const { payment } = await makeQuoted();
    expect((await post(payment.id, {})).status).toBe(400);
    await expectUntouched(payment.id);
  });

  describe("sending", () => {
    it("answers the same signed deposit a second time without sending it again", async () => {
      const { own, payment } = await makeQuoted();
      const deposit = signedDeposit(payment, own);
      await post(payment.id, { xdr: deposit.xdr });

      const again = await post(payment.id, { xdr: deposit.xdr });

      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({
        status: "AUTHORIZED",
        stellarTxHash: deposit.hash,
      });
      expect(sendSigned).toHaveBeenCalledTimes(1);
      expect(enqueueSettle).toHaveBeenCalledTimes(1);
    });

    it("takes one signed deposit for a payment and no second one", async () => {
      const { own, payment } = await makeQuoted();
      const first = signedDeposit(payment, own);
      await post(payment.id, { xdr: first.xdr });

      const second = signedDeposit(payment, own, { maxTime: Math.floor(Date.now() / 1000) + 40 });
      const res = await post(payment.id, { xdr: second.xdr });

      expect(res.status).toBe(409);
      expect(sendSigned).toHaveBeenCalledTimes(1);
      const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(after.stellarTxHash).toBe(first.hash);
    });

    it("fails the payment when the network will not run the deposit", async () => {
      sendSigned.mockResolvedValue({ status: "rejected", code: "txBadSeq" });
      const { own, payment } = await makeQuoted();

      const res = await post(payment.id, { xdr: signedDeposit(payment, own).xdr });

      expect(res.status).toBe(409);
      const body = (await res.json()) as ErrorBody;
      expect(body.error.details).toMatchObject({ reason: "network_rejected", code: "txBadSeq" });
      const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(after.status).toBe("FAILED");
      expect(after.failureReason).toContain("txBadSeq");
      // Nothing moved, so there is nothing for the settle job to look for.
      expect(enqueueSettle).not.toHaveBeenCalled();
    });

    it("goes on when the network turns away a deposit the escrow already holds", async () => {
      // The payer sent what they signed themselves, then handed it over.
      sendSigned.mockResolvedValue({ status: "rejected", code: "txBadSeq" });
      const { own, payment } = await makeQuoted();
      getJob.mockResolvedValue({
        from: own.publicKey(),
        amount: dec("8.3333334"),
        deadlineLedger: 100,
        status: "Held",
      });

      const res = await post(payment.id, { xdr: signedDeposit(payment, own).xdr });

      expect(res.status).toBe(200);
      const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(after.status).toBe("AUTHORIZED");
      expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
    });

    it("still fails it when the escrow holds some other deposit under the payment's job", async () => {
      sendSigned.mockResolvedValue({ status: "rejected", code: "txBadSeq" });
      const { own, payment } = await makeQuoted();
      getJob.mockResolvedValue({
        from: own.publicKey(),
        amount: dec("0.0000001"),
        deadlineLedger: 100,
        status: "Held",
      });

      const res = await post(payment.id, { xdr: signedDeposit(payment, own).xdr });

      expect(res.status).toBe(409);
      const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(after.status).toBe("FAILED");
      expect(enqueueSettle).not.toHaveBeenCalled();
    });

    it("asks a busy network again", async () => {
      sendSigned
        .mockResolvedValueOnce({ status: "busy" })
        .mockResolvedValueOnce({ status: "accepted" });
      const { own, payment } = await makeQuoted();

      const res = await post(payment.id, { xdr: signedDeposit(payment, own).xdr });

      expect(res.status).toBe(200);
      expect(sendSigned).toHaveBeenCalledTimes(2);
      expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
    });

    it("leaves it to the chain when the network cannot be reached", async () => {
      sendSigned.mockRejectedValue(new Error("socket hang up"));
      const { own, payment } = await makeQuoted();

      const res = await post(payment.id, { xdr: signedDeposit(payment, own).xdr });

      // It may have got through: the payment goes on and the settle job finds out.
      expect(res.status).toBe(200);
      const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(after.status).toBe("AUTHORIZED");
      expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
    });
  });

  describe("who may sign, and when", () => {
    it("refuses a payer on the custodial wallet", async () => {
      const { own, payment } = await makeQuoted({ walletMode: "CUSTODIAL" });
      const res = await post(payment.id, { xdr: signedDeposit(payment, own).xdr });
      expect(res.status).toBe(409);
      await expectUntouched(payment.id);
    });

    it("refuses another payer's payment", async () => {
      const { own, payment } = await makeQuoted();
      const { user: other } = await makePayer();
      sessionUser.current = {
        id: other.id,
        username: other.username,
        role: "PAYER",
        isActive: true,
      };
      const res = await post(payment.id, { xdr: signedDeposit(payment, own).xdr });
      expect(res.status).toBe(403);
      await expectUntouched(payment.id);
    });

    it("refuses an expired quote", async () => {
      const { own, payment } = await makeQuoted({ quoteExpiresInMs: -1000 });
      const res = await post(payment.id, { xdr: signedDeposit(payment, own).xdr });
      expect(res.status).toBe(409);
      await expectUntouched(payment.id);
    });

    it("refuses a payment that is no longer a quote", async () => {
      const { own, payment } = await makeQuoted({ status: "FAILED" });
      const res = await post(payment.id, { xdr: signedDeposit(payment, own).xdr });
      expect(res.status).toBe(409);
      expect(sendSigned).not.toHaveBeenCalled();
    });

    it("refuses when no escrow holds the payment's asset", async () => {
      holdsAsset.mockResolvedValue(false);
      const { own, payment } = await makeQuoted();
      const res = await post(payment.id, { xdr: signedDeposit(payment, own).xdr });
      expect(res.status).toBe(409);
      await expectUntouched(payment.id);
    });

    it("answers 404 while the feature is off", async () => {
      const { own, payment } = await makeQuoted();
      process.env.NONCUSTODIAL_ENABLED = "false";
      const res = await post(payment.id, { xdr: signedDeposit(payment, own).xdr });
      expect(res.status).toBe(404);
      await expectUntouched(payment.id);
    });

    it("needs a signed-in payer", async () => {
      const { own, payment } = await makeQuoted();
      sessionUser.current = null;
      const res = await post(payment.id, { xdr: signedDeposit(payment, own).xdr });
      expect(res.status).toBe(401);
      await expectUntouched(payment.id);
    });
  });
});

describe("confirmPayment for a payer who chose their own wallet", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.NONCUSTODIAL_ENABLED = "true";
    await resetDb();
  });
  afterEach(() => {
    delete process.env.NONCUSTODIAL_ENABLED;
  });

  it("does not pay from the HeyPay wallet in their place", async () => {
    const { user, payment } = await makeQuoted();
    await expect(
      confirmPayment({ paymentId: payment.id, payerId: user.id, idemKey: "k-own-1" }),
    ).rejects.toMatchObject({ status: 409 });
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("QUOTED");
    expect(enqueueSettle).not.toHaveBeenCalled();
  });
});
