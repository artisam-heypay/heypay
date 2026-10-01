// src/server/payer/faucet.ts
//
// Testnet faucet: a payer claims a little test XLM once, straight into their
// custodial wallet, so anyone can try a HeyPay payment without first hunting for
// test funds. The XLM comes from a dedicated faucet account (FAUCET_SECRET_ENC),
// never the treasury, and the faucet refuses to run on mainnet.
import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { dec, type Decimal } from "@/lib/money";
import { AppError, conflict, notFound } from "@/lib/errors";
import { stellarTxUrl } from "@/lib/stellar-explorer";
import { db } from "@/server/db";
import { audit } from "@/server/auth/audit";
import { captureUserEvent } from "@/server/observability/analytics";
import { captureException } from "@/server/observability/error-tracking";
import { syncWalletDeposits } from "@/server/queue/jobs/deposit-poller";
import { isMainnet } from "@/server/stellar/horizon";
import { walletService } from "@/server/stellar/wallet";

const DEFAULT_AMOUNT_XLM = "20";
// Memo text is capped at 28 bytes.
const FAUCET_MEMO = "HeyPay test XLM";

export type FaucetStatus =
  { enabled: false } | { enabled: true; amountXlm: string; claimed: boolean; txUrl: string | null };

export type FaucetClaimResult = { amountXlm: string; txHash: string; txUrl: string };

function faucetSecret(): string | null {
  return process.env.FAUCET_SECRET_ENC?.trim() || null;
}

/** On only off mainnet, and only once a faucet account is configured. */
export function faucetEnabled(): boolean {
  return !isMainnet() && faucetSecret() !== null;
}

export function faucetAmountXlm(): Decimal {
  return dec(process.env.FAUCET_AMOUNT_XLM?.trim() || DEFAULT_AMOUNT_XLM);
}

export async function getFaucetStatus(userId: string): Promise<FaucetStatus> {
  if (!faucetEnabled()) return { enabled: false };
  const claim = await db.faucetClaim.findUnique({ where: { userId } });
  return {
    enabled: true,
    amountXlm: faucetAmountXlm().toFixed(7),
    // A FAILED claim can be retried, so it does not count as claimed.
    claimed: claim !== null && claim.status !== "FAILED",
    txUrl: claim?.txHash ? stellarTxUrl(claim.txHash) : null,
  };
}

/**
 * Reserve the user's single claim. The unique userId makes this race-safe: a
 * double-click creates one row and the second request sees it. Only a claim
 * whose send failed outright may be taken again.
 */
async function reserveClaim(userId: string, amount: Decimal): Promise<void> {
  try {
    await db.faucetClaim.create({ data: { userId, amountXlm: amount.toFixed(7) } });
    return;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  const retried = await db.faucetClaim.updateMany({
    where: { userId, status: "FAILED" },
    data: { status: "PENDING", amountXlm: amount.toFixed(7), txHash: null },
  });
  if (retried.count === 0) throw conflict("You have already claimed your test XLM.");
}

export async function claimFaucet(
  user: { id: string; role: string },
  ip?: string,
): Promise<FaucetClaimResult> {
  const secret = faucetSecret();
  if (!faucetEnabled() || !secret) throw notFound("The test XLM faucet is not available.");

  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");

  const amount = faucetAmountXlm();
  await reserveClaim(user.id, amount);

  let txHash: string;
  try {
    ({ txHash } = await walletService.fundXlm({
      encryptedSecret: secret,
      destination: wallet.stellarPublicKey,
      amountXlm: amount,
      memo: FAUCET_MEMO,
    }));
  } catch (err) {
    await db.faucetClaim.update({ where: { userId: user.id }, data: { status: "FAILED" } });
    captureException(err, { source: "faucet", userId: user.id });
    throw new AppError(
      "FAUCET_UNAVAILABLE",
      "Could not send test XLM right now. Please try again in a moment.",
      503,
    );
  }

  await db.faucetClaim.update({ where: { userId: user.id }, data: { status: "SENT", txHash } });

  // Credit the deposit now rather than waiting for the poller, so the balance
  // moves the moment the claim succeeds. The poller catches up if this fails.
  try {
    await syncWalletDeposits(wallet.id);
  } catch (err) {
    captureException(err, { source: "faucet.sync", userId: user.id });
  }

  await audit({
    actorId: user.id,
    action: "wallet.faucet.claim",
    target: wallet.id,
    metadata: { amountXlm: amount.toFixed(7), txHash },
    ip,
  });
  captureUserEvent("wallet_faucet_claimed", user, {
    amount_xlm: amount.toFixed(7),
    wallet_address: wallet.stellarPublicKey,
    stellar_tx_hash: txHash,
  });

  return { amountXlm: amount.toFixed(7), txHash, txUrl: stellarTxUrl(txHash) };
}
