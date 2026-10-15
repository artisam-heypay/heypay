// src/server/queue/jobs/wallet-activate.ts
//
// Puts a new custodial wallet on the network with the trustlines its enabled
// assets need, at HeyPay's expense, so a payer can receive USDC the moment they
// sign up instead of having to fund the wallet with XLM first.
//
// The network asks for a reserve of 1 XLM for the account and 0.5 XLM for each
// trustline. Here that reserve is sponsored: it stays locked in the balance of
// the sponsor account (WALLET_SPONSOR_SECRET_ENC) and never enters the wallet.
// The wallet holds only what was deposited into it, so the reserve is not in
// the payer's balance, on-chain or in HeyPay, and the payer cannot spend it.
//
// Without a sponsor account nothing happens here, and a wallet gets its
// trustline the older way: from the payer's own XLM, once they have funded it
// (see the deposit poller).
import "server-only";
import { enabledAssets, isIssuedAsset } from "@/lib/assets";
import { audit } from "@/server/auth/audit";
import { db } from "@/server/db";
import { captureUserEvent } from "@/server/observability/analytics";
import { assetContract } from "@/server/observability/payment-trail";
import { isAssetConfigured } from "@/server/stellar/assets";
import { walletService } from "@/server/stellar/wallet";
import { walletSponsorSecret } from "@/server/wallet/activation";
import { markTrustlineEstablished } from "@/server/wallet/balances";

/**
 * Safe to run again for the same payer: an account that already holds every
 * trustline is left alone. Throws when the transaction is refused, so the queue
 * retries it.
 */
export async function processWalletActivateJob(job: { data: { userId: string } }): Promise<void> {
  const sponsorEncryptedSecret = walletSponsorSecret();
  if (!sponsorEncryptedSecret) return;
  const assets = enabledAssets().filter(isIssuedAsset).filter(isAssetConfigured);
  if (assets.length === 0) return; // XLM needs no trustline
  const wallet = await db.custodialWallet.findUnique({ where: { userId: job.data.userId } });
  if (!wallet) return;

  const result = await walletService.activateSponsored({
    sponsorEncryptedSecret,
    encryptedSecret: wallet.encryptedSecret,
    assets,
  });
  // Every asset is trusted now; the hash belongs only to the lines this run added.
  for (const asset of assets) {
    const added = result.trustlines.includes(asset);
    await markTrustlineEstablished(wallet.id, asset, added ? result.txHash : null);
    if (!added) continue;
    // Custodial wallets belong to payers only.
    captureUserEvent(
      "wallet_trustline_added",
      { id: wallet.userId, role: "PAYER" },
      {
        asset,
        ...assetContract(asset),
        automatic: true,
        sponsored: true,
        wallet_address: wallet.stellarPublicKey,
        stellar_tx_hash: result.txHash,
      },
    );
  }
  if (!result.txHash) return;
  await audit({
    action: "wallet.activate.sponsored",
    target: wallet.id,
    metadata: {
      publicKey: wallet.stellarPublicKey,
      accountCreated: result.created,
      trustlines: result.trustlines,
      txHash: result.txHash,
    },
  });
}
