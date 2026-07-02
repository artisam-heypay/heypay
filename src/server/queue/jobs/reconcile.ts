// src/server/queue/jobs/reconcile.ts
import "server-only";
import { db } from "@/server/db";
import { walletService } from "@/server/stellar/wallet";
import { audit } from "@/server/auth/audit";
import { dec } from "@/lib/money";

// TODO(pdax-reconcile): once PaymentRailProvider exposes transaction listing, diff PDAX history vs local Payments.

export async function processReconcileJob(): Promise<{ checked: number; drift: number }> {
  const wallets = await db.custodialWallet.findMany();
  let drift = 0;

  for (const wallet of wallets) {
    let horizon;
    try {
      horizon = await walletService.getBalance(wallet.stellarPublicKey);
    } catch (err) {
      console.error("[reconcile] getBalance failed", {
        walletId: wallet.id,
        error: (err as Error).message,
      });
      continue;
    }
    const cached = dec(wallet.cachedXlmBalance.toString());
    if (!cached.equals(horizon)) {
      drift++;
      await audit({
        action: "reconcile.drift",
        target: wallet.id,
        metadata: {
          publicKey: wallet.stellarPublicKey,
          cachedXlm: cached.toFixed(7),
          horizonXlm: horizon.toFixed(7),
          deltaXlm: horizon.minus(cached).toFixed(7),
        },
      });
    }
  }

  return { checked: wallets.length, drift };
}
