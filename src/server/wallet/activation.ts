// src/server/wallet/activation.ts
//
// The sign-up side of sponsored wallet activation: whether a sponsor account
// is configured, and the request that hands a new wallet to the worker. What
// the worker then does is in queue/jobs/wallet-activate.ts.
import "server-only";
import { captureException } from "@/server/observability/error-tracking";

/**
 * Envelope-encrypted secret of the account that pays the network reserves of
 * new custodial wallets, or null when none is configured.
 */
export function walletSponsorSecret(): string | null {
  return process.env.WALLET_SPONSOR_SECRET_ENC?.trim() || null;
}

/**
 * Ask the worker to put a new payer's wallet on the network. Call it once the
 * transaction that created the wallet has committed, or the worker may look
 * for the wallet before it exists.
 *
 * Does nothing for other roles or without a sponsor account. Never throws: a
 * sign-up must not fail over it, and a wallet that is never activated still
 * works, it only takes the payer's own XLM to add a trustline.
 */
export async function requestWalletActivation(user: { id: string; role: string }): Promise<void> {
  if (user.role !== "PAYER" || !walletSponsorSecret()) return;
  try {
    // Loaded on demand: importing the queue module opens its Redis connection,
    // which sign-up has no other use for.
    const { enqueueWalletActivation } = await import("@/server/queue/queues");
    await enqueueWalletActivation(user.id);
  } catch (err) {
    captureException(err, { source: "wallet-activate.enqueue", userId: user.id });
  }
}
