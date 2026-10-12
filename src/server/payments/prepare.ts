// src/server/payments/prepare.ts
//
// For a payer who signs with their own wallet: says what the escrow deposit for
// a quoted payment must be, so the payer's browser can build it and their
// wallet can sign it. HeyPay builds and signs nothing here, and holds no key
// that could. Every value comes from the payment itself, so the signed
// transaction that comes back can be checked against the same payment.
import "server-only";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { conflict, forbidden, notFound } from "@/lib/errors";
import type { EscrowDepositInstructions } from "@/lib/client/escrow-deposit";
import { escrowAppliesTo, escrowContractId } from "@/server/stellar/escrow-config";
import { escrowHoldsAsset, escrowJobId, toStroops } from "@/server/stellar/escrow";
import { getNetworkPassphrase, isMainnet } from "@/server/stellar/horizon";
import { walletService } from "@/server/stellar/wallet";

// Long enough to read and approve the payment in the wallet, and no longer: a
// deposit left valid is one the payer could still send much later.
const DEPOSIT_VALID_SECONDS = 120;

export async function prepareEscrowDeposit(input: {
  paymentId: string;
  payerId: string;
}): Promise<EscrowDepositInstructions> {
  const payment = await db.payment.findUnique({
    where: { id: input.paymentId },
    include: { payer: { select: { walletMode: true, externalPublicKey: true } } },
  });
  if (!payment) throw notFound("payment not found");
  if (payment.payerId !== input.payerId) throw forbidden("not your payment");

  // Only a payer who chose their own wallet signs anything themselves.
  const from = payment.payer.walletMode === "EXTERNAL" ? payment.payer.externalPublicKey : null;
  if (!from) throw conflict("This payment is paid from your HeyPay wallet.");

  if (payment.status !== "QUOTED") {
    throw conflict(`cannot prepare payment in status ${payment.status}`);
  }
  const quoteExpiresAt = payment.quoteExpiresAt?.getTime() ?? 0;
  if (quoteExpiresAt < Date.now()) throw conflict("quote expired; please re-quote");

  const asset = payment.asset;
  const contractId = escrowContractId(asset);
  if (!escrowAppliesTo(asset) || !contractId || !(await escrowHoldsAsset(asset))) {
    throw conflict(`HeyPay cannot hold ${asset} payments in escrow right now.`);
  }
  // The account pays from its own balance, so it has to exist on this network
  // and, for an issued asset, hold a line to it.
  if (!(await walletService.canReceive(from, asset))) {
    const network = isMainnet() ? "Mainnet" : "Testnet";
    throw conflict(
      asset === "XLM"
        ? `Your wallet's account does not exist on ${network} yet. Fund it, then try again.`
        : `Your wallet cannot hold ${asset} on ${network} yet. Add ${asset} to it, then try again.`,
    );
  }

  // The payer's browser asks this server to simulate the deposit.
  const rpcUrl = process.env.SOROBAN_RPC_URL;
  if (!rpcUrl) throw new Error("SOROBAN_RPC_URL is not set");

  // The deposit is never valid past the quote: its rate is only promised until
  // then. Worked out last, so the checks above do not eat into it. Whole
  // seconds, as the network counts them.
  const now = Date.now();
  const validUntil =
    Math.floor(Math.min(now + DEPOSIT_VALID_SECONDS * 1000, quoteExpiresAt) / 1000) * 1000;
  if (validUntil - now < 1000) throw conflict("quote expired; please re-quote");

  return {
    paymentId: payment.id,
    contractId,
    jobId: escrowJobId(payment.id).toString("hex"),
    from,
    // The quoted amount and nothing on top: the payer's wallet pays the network
    // fee itself, as the transaction's source.
    amount: toStroops(dec(payment.amountAsset.toString())).toString(),
    networkPassphrase: getNetworkPassphrase(),
    rpcUrl,
    validUntil: new Date(validUntil).toISOString(),
  };
}
