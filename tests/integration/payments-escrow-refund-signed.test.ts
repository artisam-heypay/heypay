import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  Account,
  Contract,
  Keypair,
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
import type { EscrowTimeoutRefundInstructions } from "@/lib/client/escrow-timeout-refund";

const PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT_ID = "CDGIYVERJJ7JWIZBHNV3BYGKFOFHNTRAS4XW4KKV4ROTWQAGENI3LE5E";
const OTHER_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
const RPC_URL = "https://rpc.test";
const DEADLINE = 1_000;

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

// The network and the contract: what they answer.
const { sendSigned, awaitSent, getJob, getLatestLedger } = vi.hoisted(() => ({
  sendSigned: vi.fn(),
  awaitSent: vi.fn(),
  getJob: vi.fn(),
  getLatestLedger: vi.fn(),
}));
vi.mock("@/server/stellar/escrow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/stellar/escrow")>()),
  sendSignedTransaction: (tx: Transaction) => sendSigned(tx),
  awaitSentTransaction: (hash: string, giveUpAt: number) => awaitSent(hash, giveUpAt),
  escrowFor: () => ({
    getJob: (jobId: Buffer) => getJob(jobId),
    getLatestLedger: () => getLatestLedger(),
    refund: vi.fn(),
  }),
}));
const { confirmTx } = vi.hoisted(() => ({ confirmTx: vi.fn() }));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: { confirmTx: (h: string) => confirmTx(h) },
}));
const { cancelPayout } = vi.hoisted(() => ({ cancelPayout: vi.fn() }));
vi.mock("@/server/rails", () => ({
  fastSettleEnabled: () => false,
  rail: { cancelPayout: (r: string) => cancelPayout(r), getPayoutStatus: vi.fn() },
}));
const { enqueueSettle } = vi.hoisted(() => ({
  enqueueSettle: vi.fn(async (_id: string, _opts?: { delayMs?: number }) => {}),
}));
vi.mock("@/server/queue/queues", () => ({
  QUEUE_NAMES: { settle: "settle", depositPoll: "deposit-poll", reconcile: "reconcile" },
  enqueueSettle,
}));

import { POST as prepare } from "@/app/api/payments/[id]/escrow-refund/prepare/route";
import { POST as signed } from "@/app/api/payments/[id]/escrow-refund/signed/route";
import { POST as custodialRefund } from "@/app/api/payments/[id]/escrow-refund/route";
import { escrowJobId } from "@/server/stellar/escrow";
import { escrowSelfRefundState } from "@/server/payments/escrow-self-refund";
import { processSettleJob } from "@/server/queue/jobs/settle";

const sameOrigin = { origin: "http://localhost", "sec-fetch-site": "same-origin" };

function request(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { ...sameOrigin, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const postPrepare = (id: string) =>
  prepare(request(`/api/payments/${id}/escrow-refund/prepare`), params(id));
const postSigned = (id: string, body: unknown) =>
  signed(request(`/api/payments/${id}/escrow-refund/signed`, body), params(id));

/**
 * A payment whose deposit the payer signed with their own wallet, held in the
 * escrow. `payout`: "sent" has a payout at the rail, "none" was never requested.
 */
async function makeHeld(opts?: { status?: PaymentStatus; payout?: "sent" | "none" }) {
  const own = Keypair.random();
  const { user, wallet } = await makePayer({ cachedXlm: "50.0000000" });
  await db.user.update({
    where: { id: user.id },
    data: { externalPublicKey: own.publicKey(), walletMode: "EXTERNAL" },
  });
  const { merchant } = await makeMerchant();
  const created = await db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: "100.00",
      quotedRate: "12.00000000",
      amountAsset: "8.3333334",
      networkFeeXlm: "0.0000100",
      status: opts?.status ?? "STELLAR_CONFIRMED",
      stellarTxHash: `DEPOSIT-${user.id}`,
      externalPublicKey: own.publicKey(),
      payoutRef: opts?.payout === "sent" ? "disb-1" : null,
      payoutRequestedAt: opts?.payout === "sent" ? new Date() : null,
    },
  });
  const payment = await db.payment.update({
    where: { id: created.id },
    data: { escrowJobId: escrowJobId(created.id).toString("hex") },
  });
  sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
  getJob.mockResolvedValue({
    from: own.publicKey(),
    amount: dec("8.3333334"),
    deadlineLedger: DEADLINE,
    status: "Held",
  });
  return { user, wallet, own, payment };
}

type RefundParts = {
  source: string;
  /** Who signs it; null leaves it unsigned. */
  signer: Keypair | null;
  contractId: string;
  fn: string;
  jobId: Buffer;
  /** Seconds since the epoch; 0 never expires. */
  maxTime: number;
  passphrase: string;
};

/**
 * The refund a payer's browser builds and their wallet signs, as XDR. `change`
 * swaps out one part of it, the way a tampered one would differ.
 */
function signedRefund(
  payment: { id: string },
  own: Keypair,
  change: Partial<RefundParts> = {},
): { xdr: string; hash: string } {
  const parts: RefundParts = {
    source: own.publicKey(),
    signer: own,
    contractId: CONTRACT_ID,
    fn: "refund_after_timeout",
    jobId: escrowJobId(payment.id),
    maxTime: Math.floor(Date.now() / 1000) + 60,
    passphrase: PASSPHRASE,
    ...change,
  };
  const tx = new TransactionBuilder(new Account(parts.source, "41"), {
    fee: "100000",
    networkPassphrase: parts.passphrase,
    timebounds: { minTime: 0, maxTime: parts.maxTime },
  })
    .addOperation(
      new Contract(parts.contractId).call(parts.fn, nativeToScVal(parts.jobId, { type: "bytes" })),
    )
    .build();
  if (parts.signer) tx.sign(parts.signer);
  return { xdr: tx.toXDR(), hash: tx.hash().toString("hex") };
}

type ErrorBody = { error: { message: string; details?: { reason?: string } } };
const reason = async (res: Response) => ((await res.json()) as ErrorBody).error.details?.reason;

/** Nothing was sent, no payout was touched, and the payment is as it was. */
async function expectUntouched(paymentId: string, status: PaymentStatus = "STELLAR_CONFIRMED") {
  expect(sendSigned).not.toHaveBeenCalled();
  expect(cancelPayout).not.toHaveBeenCalled();
  expect(enqueueSettle).not.toHaveBeenCalled();
  const after = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  expect(after.status).toBe(status);
  expect(after.refundTxHash).toBeNull();
  expect(after.refundSubmittedAt).toBeNull();
}

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.NONCUSTODIAL_ENABLED = "true";
  process.env.ESCROW_ENABLED = "true";
  process.env.ESCROW_CONTRACT_ID = CONTRACT_ID;
  process.env.SOROBAN_RPC_URL = RPC_URL;
  sessionUser.current = null;
  sendSigned.mockReset().mockResolvedValue({ status: "accepted" });
  awaitSent.mockReset().mockResolvedValue("SUCCESS");
  getJob.mockReset().mockResolvedValue(null);
  // Past the deadline, unless a test says otherwise.
  getLatestLedger.mockReset().mockResolvedValue(DEADLINE + 2);
  cancelPayout.mockReset().mockResolvedValue({ state: "FAILED", failureCode: "CANCELLED" });
  confirmTx.mockReset().mockResolvedValue(true);
  await resetDb();
});
afterEach(() => {
  delete process.env.NONCUSTODIAL_ENABLED;
  delete process.env.ESCROW_ENABLED;
  delete process.env.ESCROW_CONTRACT_ID;
  delete process.env.SOROBAN_RPC_URL;
});

describe("escrowSelfRefundState for a deposit from the payer's own wallet", () => {
  it("opens only once the job is held past its deadline, and names the wallet that signs", async () => {
    const { own, payment } = await makeHeld();

    getLatestLedger.mockResolvedValue(DEADLINE - 4);
    expect(await escrowSelfRefundState(payment)).toMatchObject({
      available: false,
      secondsUntilAvailable: 20,
    });

    getLatestLedger.mockResolvedValue(DEADLINE);
    expect(await escrowSelfRefundState(payment)).toEqual({
      available: true,
      secondsUntilAvailable: 0,
      waitingOnPayout: false,
      ownWallet: {
        address: own.publicKey(),
        networkPassphrase: PASSPHRASE,
        networkName: "Testnet",
      },
    });
  });

  it("offers nothing once the escrow no longer holds the job", async () => {
    const { own, payment } = await makeHeld();
    getJob.mockResolvedValue({
      from: own.publicKey(),
      amount: dec("8.3333334"),
      deadlineLedger: DEADLINE,
      status: "Released",
    });
    expect(await escrowSelfRefundState(payment)).toBeNull();
  });

  it("offers nothing while own wallets are off", async () => {
    const { payment } = await makeHeld();
    process.env.NONCUSTODIAL_ENABLED = "false";
    expect(await escrowSelfRefundState(payment)).toBeNull();
    expect(getJob).not.toHaveBeenCalled();
  });
});

describe("POST /api/payments/[id]/escrow-refund/prepare", () => {
  it("says what the refund must be, and builds, signs and marks nothing", async () => {
    const { own, payment } = await makeHeld();

    const res = await postPrepare(payment.id);

    expect(res.status).toBe(200);
    const body = (await res.json()) as EscrowTimeoutRefundInstructions;
    expect(body).toEqual({
      paymentId: payment.id,
      contractId: CONTRACT_ID,
      jobId: escrowJobId(payment.id).toString("hex"),
      from: own.publicKey(),
      networkPassphrase: PASSPHRASE,
      rpcUrl: RPC_URL,
      validUntil: expect.any(String),
    });
    const secondsLeft = (Date.parse(body.validUntil) - Date.now()) / 1000;
    expect(secondsLeft).toBeGreaterThan(110);
    expect(secondsLeft).toBeLessThanOrEqual(120);
    await expectUntouched(payment.id);
  });

  it("follows the payment, not the wallet the payer pays with now", async () => {
    const { user, own, payment } = await makeHeld();
    await db.user.update({ where: { id: user.id }, data: { walletMode: "CUSTODIAL" } });

    const res = await postPrepare(payment.id);

    expect(res.status).toBe(200);
    expect(((await res.json()) as EscrowTimeoutRefundInstructions).from).toBe(own.publicKey());
  });

  it("refuses before the deadline, saying when it opens", async () => {
    const { payment } = await makeHeld();
    getLatestLedger.mockResolvedValue(DEADLINE - 3);

    const res = await postPrepare(payment.id);

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.message).toMatch(/opens in about 15 seconds/);
  });

  it("refuses a payment paid from the HeyPay wallet", async () => {
    const { payment } = await makeHeld();
    await db.payment.update({ where: { id: payment.id }, data: { externalPublicKey: null } });
    expect((await postPrepare(payment.id)).status).toBe(409);
    expect(getJob).not.toHaveBeenCalled();
  });

  it("refuses another payer's payment, and answers 404 while own wallets are off", async () => {
    const { payment } = await makeHeld();
    const { user: other } = await makePayer();
    sessionUser.current = { id: other.id, username: other.username, role: "PAYER", isActive: true };
    expect((await postPrepare(payment.id)).status).toBe(403);

    process.env.NONCUSTODIAL_ENABLED = "false";
    expect((await postPrepare(payment.id)).status).toBe(404);
  });
});

describe("POST /api/payments/[id]/escrow-refund/signed", () => {
  it("takes the refund the payer signed, sends it as it came, and the settle job marks the payment refunded", async () => {
    const { user, wallet, own, payment } = await makeHeld();
    const refund = signedRefund(payment, own);

    const res = await postSigned(payment.id, { xdr: refund.xdr });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      refundTxHash: refund.hash,
      status: "REFUND_PENDING",
      failureReason: "Escrow deadline passed before the payment settled",
      refundTxUrl: expect.stringContaining(refund.hash),
    });
    // The very transaction the payer signed, signature and all.
    expect(sendSigned).toHaveBeenCalledTimes(1);
    expect((sendSigned.mock.calls[0]![0] as Transaction).toXDR()).toBe(refund.xdr);
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);

    const pending = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(pending.status).toBe("REFUND_PENDING");
    expect(pending.refundTxHash).toBe(refund.hash);
    const audits = await db.auditLog.findMany({ where: { action: "payment.escrow_self_refund" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(user.id);
    expect(audits[0]!.metadata).toMatchObject({ signedBy: "payer", refundedTo: own.publicKey() });

    await processSettleJob({ data: { paymentId: payment.id } });

    const closed = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(closed.status).toBe("REFUNDED");
    // The contract paid the payer's own account: no HeyPay balance is credited.
    expect(await db.walletTransaction.count()).toBe(0);
    const after = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.cachedXlmBalance.toFixed(7)).toBe("50.0000000");
  });

  it("stops the payout before the refund is sent", async () => {
    const { own, payment } = await makeHeld({ status: "PAYOUT_SUBMITTED", payout: "sent" });
    const order: string[] = [];
    cancelPayout.mockImplementation(async () => {
      order.push("cancel");
      return { state: "FAILED", failureCode: "CANCELLED" };
    });
    sendSigned.mockImplementation(async () => {
      order.push("send");
      return { status: "accepted" };
    });

    const res = await postSigned(payment.id, { xdr: signedRefund(payment, own).xdr });

    expect(res.status).toBe(200);
    expect(cancelPayout).toHaveBeenCalledWith("disb-1");
    expect(order).toEqual(["cancel", "send"]);
  });

  it("sends nothing while the bank transfer cannot be stopped", async () => {
    const { own, payment } = await makeHeld({ status: "PAYOUT_SUBMITTED", payout: "sent" });
    cancelPayout.mockResolvedValue({ state: "PENDING", railStatus: "REQUESTED" });

    const res = await postSigned(payment.id, { xdr: signedRefund(payment, own).xdr });

    expect(res.status).toBe(409);
    expect(sendSigned).not.toHaveBeenCalled();
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("PAYOUT_SUBMITTED");
    expect(after.refundSubmittedAt).toBeNull();
  });

  it("closes a payment cancelled at the deadline, which was waiting for the payer", async () => {
    const { own, payment } = await makeHeld({ status: "REFUND_PENDING" });
    await db.payment.update({
      where: { id: payment.id },
      data: {
        failureReason:
          "The merchant was not paid within the time limit, so this payment was cancelled",
      },
    });
    await db.paymentEvent.create({
      data: {
        paymentId: payment.id,
        fromStatus: "STELLAR_CONFIRMED",
        toStatus: "REFUND_PENDING",
        detail: { awaitsPayerRefund: true },
      },
    });

    const res = await postSigned(payment.id, { xdr: signedRefund(payment, own).xdr });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "REFUND_PENDING",
      failureReason:
        "The merchant was not paid within the time limit, so this payment was cancelled",
    });
    await processSettleJob({ data: { paymentId: payment.id } });
    const closed = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(closed.status).toBe("REFUNDED");
  });

  describe("a transaction that is not the refund for the payment", () => {
    const tampered: [string, Partial<RefundParts>][] = [
      ["another payment's job id", { jobId: escrowJobId("some-other-payment") }],
      ["a different contract", { contractId: OTHER_CONTRACT_ID }],
      ["a different contract function", { fn: "refund" }],
      ["a last valid second of 0, which never expires", { maxTime: 0 }],
      [
        "validity longer than a refund named now could have",
        { maxTime: Math.floor(Date.now() / 1000) + 600 },
      ],
    ];
    it.each(tampered)("refuses %s", async (_name, change) => {
      const { own, payment } = await makeHeld();
      const res = await postSigned(payment.id, { xdr: signedRefund(payment, own, change).xdr });
      expect(res.status).toBe(400);
      expect(await reason(res)).toBe("not_the_refund");
      await expectUntouched(payment.id);
    });

    it("refuses another source account, even signed by that account", async () => {
      const { own, payment } = await makeHeld();
      const other = Keypair.random();
      const res = await postSigned(payment.id, {
        xdr: signedRefund(payment, own, { source: other.publicKey(), signer: other }).xdr,
      });
      expect(res.status).toBe(400);
      expect(await reason(res)).toBe("not_the_refund");
      await expectUntouched(payment.id);
    });

    it.each([
      ["unsigned", null],
      ["signed by another key", Keypair.random()],
    ])("refuses one that is %s", async (_name, signer) => {
      const { own, payment } = await makeHeld();
      const res = await postSigned(payment.id, { xdr: signedRefund(payment, own, { signer }).xdr });
      expect(res.status).toBe(400);
      expect(await reason(res)).toBe("not_signed");
      await expectUntouched(payment.id);
    });

    it("refuses one signed for another network", async () => {
      const { own, payment } = await makeHeld();
      const res = await postSigned(payment.id, {
        xdr: signedRefund(payment, own, {
          passphrase: "Public Global Stellar Network ; September 2015",
        }).xdr,
      });
      expect(res.status).toBe(400);
      expect(await reason(res)).toBe("not_signed");
      await expectUntouched(payment.id);
    });

    it("refuses one whose validity has run out", async () => {
      const { own, payment } = await makeHeld();
      const res = await postSigned(payment.id, {
        xdr: signedRefund(payment, own, { maxTime: Math.floor(Date.now() / 1000) - 5 }).xdr,
      });
      expect(res.status).toBe(400);
      expect(await reason(res)).toBe("expired");
      await expectUntouched(payment.id);
    });

    it("refuses what is not a transaction at all", async () => {
      const { payment } = await makeHeld();
      const res = await postSigned(payment.id, { xdr: "not-xdr" });
      expect(res.status).toBe(400);
      expect(await reason(res)).toBe("not_a_transaction");
      await expectUntouched(payment.id);
    });
  });

  describe("what the network answers", () => {
    it.each([
      ["turns it away", { status: "rejected", code: "txBadSeq" }, "NOT_FOUND"],
      ["runs it and it fails", { status: "accepted" }, "FAILED"],
      ["accepts it but never runs it while it is valid", { status: "accepted" }, "NOT_FOUND"],
      ["is too busy to take it", { status: "busy" }, "NOT_FOUND"],
    ])(
      "drops its claim when the network %s, so it can be tried again",
      async (_n, sent, result) => {
        const { own, payment } = await makeHeld();
        sendSigned.mockResolvedValue(sent);
        awaitSent.mockResolvedValue(result);

        const res = await postSigned(payment.id, { xdr: signedRefund(payment, own).xdr });

        expect(res.status).toBe(409);
        expect(await reason(res)).toBe("network_rejected");
        const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(after.status).toBe("STELLAR_CONFIRMED");
        expect(after.refundTxHash).toBeNull();
        expect(after.refundSubmittedAt).toBeNull();
        expect(enqueueSettle).not.toHaveBeenCalled();
      },
    );

    it("records a refund the network turns away because the payer already sent it themselves", async () => {
      const { own, payment } = await makeHeld();
      const refund = signedRefund(payment, own);
      sendSigned.mockResolvedValue({ status: "rejected", code: "txBadSeq" });
      awaitSent.mockResolvedValue("SUCCESS");

      const res = await postSigned(payment.id, { xdr: refund.xdr });

      expect(res.status).toBe(200);
      // Asked once, not waited for: the network already said it will not take it.
      expect(awaitSent).toHaveBeenCalledWith(refund.hash, 0);
      const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(after.refundTxHash).toBe(refund.hash);
    });

    it("waits for an accepted refund until it can no longer land", async () => {
      const { own, payment } = await makeHeld();
      const maxTime = Math.floor(Date.now() / 1000) + 60;
      await postSigned(payment.id, { xdr: signedRefund(payment, own, { maxTime }).xdr });
      expect(awaitSent).toHaveBeenCalledWith(expect.any(String), maxTime * 1000 + 10_000);
    });

    it("keeps its claim when the network cannot be reached: the refund may have landed", async () => {
      const { own, payment } = await makeHeld();
      sendSigned.mockRejectedValue(new Error("socket hang up"));

      const res = await postSigned(payment.id, { xdr: signedRefund(payment, own).xdr });

      expect(res.status).toBe(409);
      const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(after.refundTxHash).toBeNull();
      expect(after.refundSubmittedAt).not.toBeNull();
    });
  });

  describe("who may refund, and when", () => {
    it("answers the same signed refund a second time without sending it again", async () => {
      const { own, payment } = await makeHeld();
      const refund = signedRefund(payment, own);
      await postSigned(payment.id, { xdr: refund.xdr });

      const again = await postSigned(payment.id, { xdr: refund.xdr });

      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({ refundTxHash: refund.hash });
      expect(sendSigned).toHaveBeenCalledTimes(1);
    });

    it("refuses before the deadline", async () => {
      const { own, payment } = await makeHeld();
      getLatestLedger.mockResolvedValue(DEADLINE - 1);
      const res = await postSigned(payment.id, { xdr: signedRefund(payment, own).xdr });
      expect(res.status).toBe(409);
      await expectUntouched(payment.id);
    });

    it("refuses while another refund of the payment is in flight", async () => {
      const { own, payment } = await makeHeld();
      await db.payment.update({
        where: { id: payment.id },
        data: { refundSubmittedAt: new Date() },
      });
      const res = await postSigned(payment.id, { xdr: signedRefund(payment, own).xdr });
      expect(res.status).toBe(409);
      expect(sendSigned).not.toHaveBeenCalled();
    });

    it("refuses another payer's payment, and answers 404 while own wallets are off", async () => {
      const { own, payment } = await makeHeld();
      const xdr = signedRefund(payment, own).xdr;
      const { user: other } = await makePayer();
      sessionUser.current = {
        id: other.id,
        username: other.username,
        role: "PAYER",
        isActive: true,
      };
      expect((await postSigned(payment.id, { xdr })).status).toBe(403);

      process.env.NONCUSTODIAL_ENABLED = "false";
      expect((await postSigned(payment.id, { xdr })).status).toBe(404);
      await expectUntouched(payment.id);
    });

    it("needs a signed-in payer", async () => {
      const { own, payment } = await makeHeld();
      sessionUser.current = null;
      const res = await postSigned(payment.id, { xdr: signedRefund(payment, own).xdr });
      expect(res.status).toBe(401);
      await expectUntouched(payment.id);
    });
  });
});

describe("POST /api/payments/[id]/escrow-refund for a deposit from the payer's own wallet", () => {
  it("is refused: the HeyPay wallet did not make the deposit and cannot take it back", async () => {
    const { payment } = await makeHeld();
    const res = await custodialRefund(
      request(`/api/payments/${payment.id}/escrow-refund`),
      params(payment.id),
    );
    expect(res.status).toBe(409);
    await expectUntouched(payment.id);
  });
});

describe("settle job, for a payer who took their deposit back without the app", () => {
  async function cancelledAtDeadline() {
    const made = await makeHeld({ status: "REFUND_PENDING" });
    await db.paymentEvent.create({
      data: {
        paymentId: made.payment.id,
        fromStatus: "STELLAR_CONFIRMED",
        toStatus: "REFUND_PENDING",
        detail: { awaitsPayerRefund: true },
      },
    });
    return made;
  }

  it("leaves the payment waiting while the escrow still holds the deposit", async () => {
    const { payment } = await cancelledAtDeadline();

    await processSettleJob({ data: { paymentId: payment.id } });

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("REFUND_PENDING");
  });

  it("closes the payment once the contract says the payer has it back", async () => {
    const { own, payment } = await cancelledAtDeadline();
    getJob.mockResolvedValue({
      from: own.publicKey(),
      amount: dec("8.3333334"),
      deadlineLedger: DEADLINE,
      status: "Refunded",
    });

    await processSettleJob({ data: { paymentId: payment.id } });

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("REFUNDED");
    expect(after.refundTxHash).toBeNull(); // HeyPay never saw the transaction
    expect(await db.walletTransaction.count()).toBe(0);
  });
});
