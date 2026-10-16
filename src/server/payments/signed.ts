// src/server/payments/signed.ts
//
// Takes the escrow deposit a payer signed with their own wallet. HeyPay built
// none of it and holds no key that could sign it, so it is checked against the
// payment before the network sees it: it must be exactly
// `deposit(jobId, payer, amount)` on the escrow that holds the payment's asset,
// from the payer's own account, signed by that account's key, and valid no
// longer than the quote. Anything else is refused and the payment stays as it
// was. A deposit that passes is recorded on the payment first and sent second,
// so one that lands is never unknown to HeyPay.
import "server-only";
import { Address, nativeToScVal, type Transaction } from "@stellar/stellar-sdk";
import type { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { captureException } from "@/server/observability/error-tracking";
import { captureUserEvent } from "@/server/observability/analytics";
import { assetContract } from "@/server/observability/payment-trail";
import { syncEscrowTimeout } from "@/server/queue/jobs/settle";
import { enqueueSettle } from "@/server/queue/queues";
import { escrowAppliesTo, escrowContractId } from "@/server/stellar/escrow-config";
import {
  escrowFor,
  escrowHoldsAsset,
  escrowJobId,
  toStroops,
  type SendOutcome,
} from "@/server/stellar/escrow";
import { ownWalletAccount } from "@/server/wallet/external";
import { DEPOSIT_VALID_SECONDS, heypayWalletPays } from "./prepare";
import {
  CLOCK_SLACK_SECONDS,
  readSignedTransaction,
  sendSigned,
  shortAddress,
  signedCallFault,
} from "./signed-call";
import { applyTransition } from "./state-machine";

/** Why a signed transaction was not taken, for the screen that sent it. */
export type SignedDepositRefusal =
  /** Not a transaction this network can read. */
  | "not_a_transaction"
  /** Not the escrow deposit for this payment: something in it differs. */
  | "not_the_deposit"
  /** Its validity has run out. */
  | "expired"
  /** Not signed by the key of the payer's connected account. */
  | "not_signed";

export type SignedDepositProblem = { reason: SignedDepositRefusal; message: string };

/** What the deposit for one payment has to be. */
export type ExpectedDeposit = {
  /** The payer's own account: the transaction's source, the deposit's `from`, and its signer. */
  from: string;
  /** The escrow instance that holds the payment's asset. */
  contractId: string;
  jobId: Buffer;
  /** In stroops. */
  amount: bigint;
  /** When the quote ends, in ms: the deposit may not be valid past it. */
  quoteExpiresAt: number;
};

/**
 * Why `tx` is not the deposit for a payment, or null when it is: exactly
 * `deposit(job_id, from, amount)` on the payment's escrow, valid no later than
 * the quote whose rate it pays at and no later than a deposit named now could
 * be, and signed by the payer's connected account.
 */
export function signedDepositProblem(
  tx: Transaction,
  expected: ExpectedDeposit,
  now: number = Date.now(),
): SignedDepositProblem | null {
  const { from } = expected;
  const fault = signedCallFault(
    tx,
    {
      from,
      contractId: expected.contractId,
      method: "deposit",
      args: [
        nativeToScVal(expected.jobId, { type: "bytes" }),
        new Address(from).toScVal(),
        nativeToScVal(expected.amount, { type: "i128" }),
      ],
      notAfter: Math.min(
        expected.quoteExpiresAt,
        now + (DEPOSIT_VALID_SECONDS + CLOCK_SLACK_SECONDS) * 1000,
      ),
    },
    now,
  );
  switch (fault) {
    case null:
      return null;
    case "expired":
      return {
        reason: "expired",
        message: "The transaction you signed has expired. Nothing was sent. Try again.",
      };
    case "not_signed":
      return {
        reason: "not_signed",
        message:
          `The transaction is not signed by your connected wallet (${shortAddress(from)}). ` +
          "Switch Freighter to that account and to HeyPay's network, then try again.",
      };
    default:
      return {
        reason: "not_the_deposit",
        message: "That is not the escrow deposit for this payment. Nothing was sent. Try again.",
      };
  }
}

export type SignedDepositResult = {
  paymentId: string;
  status: PaymentStatus;
  stellarTxHash: string;
};

/**
 * Accepts the deposit the payer signed for a quoted payment and hands it to
 * the network. The payment moves to AUTHORIZED with the deposit's hash and the
 * account it comes from, and the settle job takes it from there: it confirms
 * the deposit on-chain and pays the merchant, without touching a HeyPay wallet.
 */
export async function acceptSignedDeposit(input: {
  paymentId: string;
  payerId: string;
  xdr: string;
}): Promise<SignedDepositResult> {
  const payment = await db.payment.findUnique({
    where: { id: input.paymentId },
    include: { payer: { select: { walletMode: true, externalPublicKey: true } } },
  });
  if (!payment) throw notFound("payment not found");
  if (payment.payerId !== input.payerId) throw forbidden("not your payment");

  const tx = readSignedTransaction(input.xdr);
  const txHash = tx.hash().toString("hex");
  // The same signed deposit sent a second time (a retried request) is answered
  // with where the payment stands, and not sent again.
  if (payment.externalPublicKey && payment.stellarTxHash === txHash) {
    return { paymentId: payment.id, status: payment.status, stellarTxHash: txHash };
  }

  const from = ownWalletAccount(payment.payer);
  if (!from) throw heypayWalletPays();
  if (payment.status !== "QUOTED") {
    throw conflict(`cannot sign payment in status ${payment.status}`);
  }
  const quoteExpiresAt = payment.quoteExpiresAt?.getTime() ?? 0;
  if (quoteExpiresAt < Date.now()) throw conflict("quote expired; please re-quote");

  const asset = payment.asset;
  const contractId = escrowContractId(asset);
  if (!escrowAppliesTo(asset) || !contractId || !(await escrowHoldsAsset(asset))) {
    throw conflict(`HeyPay cannot hold ${asset} payments in escrow right now.`);
  }

  const jobId = escrowJobId(payment.id);
  const amount = dec(payment.amountAsset.toString());
  const problem = signedDepositProblem(tx, {
    from,
    contractId,
    jobId,
    amount: toStroops(amount),
    quoteExpiresAt,
  });
  if (problem) throw badRequest(problem.message, { reason: problem.reason });

  // The contract gives a deposit its refund deadline as it lands, so the window
  // is set before this one is sent, as it is before a custodial deposit.
  await syncEscrowTimeout(escrowFor(asset));

  // Recorded before it is sent. Only one signed deposit is ever taken for a
  // payment, and only while it is still a quote nobody has confirmed.
  const jobIdHex = jobId.toString("hex");
  const authorized = await db.$transaction(async (client) => {
    const claimed = await client.payment.updateMany({
      where: { id: payment.id, status: "QUOTED", stellarTxHash: null },
      data: { stellarTxHash: txHash, escrowJobId: jobIdHex, externalPublicKey: from },
    });
    if (claimed.count === 0) throw conflict("This payment has already been confirmed.");
    return applyTransition(client, payment, "AUTHORIZED", {
      asset,
      externalPublicKey: from,
      stellarTxHash: txHash,
      escrowJobId: jobIdHex,
    });
  });

  let outcome: SendOutcome | null;
  try {
    outcome = await sendSigned(tx);
  } catch (err) {
    // Whether the network has it is not known. The settle job finds out from
    // the chain, and does not give up while the deposit could still land.
    captureException(err, {
      source: "payments.signed",
      paymentId: payment.id,
      reference: payment.reference,
      step: "send",
    });
    outcome = null;
  }

  // A deposit the network turns away may be one it already ran: the payer can
  // send what they signed themselves, before or while handing it over. If the
  // escrow holds it, the payment goes on. If that cannot be read, the settle
  // job finds out.
  const alreadyHeld =
    outcome?.status === "rejected" &&
    (await escrowFor(asset)
      .getJob(jobId)
      .then((job) => job !== null && job.from === from && job.amount.equals(amount))
      .catch(() => true));

  if (outcome?.status === "rejected" && !alreadyHeld) {
    // The network will not run it and nothing moved. No HeyPay balance was
    // held for the payment, so there is nothing to release.
    const failureReason = `Stellar did not accept the escrow deposit (${outcome.code})`;
    await db.$transaction(async (client) => {
      await client.payment.update({ where: { id: payment.id }, data: { failureReason } });
      await applyTransition(client, authorized, "FAILED", { failureReason });
    });
    throw conflict(
      "Stellar did not accept the transaction, so nothing was paid. Scan the code again to retry.",
      { reason: "network_rejected", code: outcome.code },
    );
  }

  captureUserEvent(
    "payment_crypto_sent",
    { id: payment.payerId, role: "PAYER" },
    {
      payment_id: payment.id,
      reference: payment.reference,
      merchant_id: payment.merchantId,
      asset,
      ...assetContract(asset),
      amount_asset: payment.amountAsset.toFixed(7),
      payer_wallet_address: from,
      destination_address: contractId,
      escrow_job_id: jobIdHex,
      stellar_tx_hash: txHash,
      signed_by: "payer",
    },
  );

  // Accepted, or (busy, unreachable) not known: either way the chain decides.
  await enqueueSettle(payment.id);
  return { paymentId: authorized.id, status: authorized.status, stellarTxHash: txHash };
}
