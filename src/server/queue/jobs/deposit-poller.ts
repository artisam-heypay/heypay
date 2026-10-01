// src/server/queue/jobs/deposit-poller.ts
import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { redis } from "@/server/redis";
import { walletService } from "@/server/stellar/wallet";
import { dec, Decimal } from "@/lib/money";
import { enabledAssets, isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { isAssetConfigured, TRUSTLINE_XLM_REQUIREMENT } from "@/server/stellar/assets";
import {
  creditAsset,
  getAssetBalance,
  getAssetBalances,
  markTrustlineEstablished,
} from "@/server/wallet/balances";

const cursorKey = (walletId: string) => `horizon:cursor:${walletId}`;

/** Enabled assets we can actually recognise on-chain (issued ones need an issuer). */
function creditableAssets(): PaymentAsset[] {
  return enabledAssets().filter(isAssetConfigured);
}

/**
 * Add the trustlines an enabled issued asset needs, without asking the payer.
 *
 * Stellar cannot be talked out of requiring a trustline — the network rejects an
 * untrusted incoming payment — so the only way to spare the payer the step is to
 * do it for them, which a custodial wallet can. It costs 0.5 XLM of extra
 * reserve per line plus a fee, so it waits until the wallet is funded; an
 * unfunded account simply cannot hold one.
 *
 * Best-effort: a failure here must never fail a deposit sync. The payer can
 * still trigger it manually from the prefund screen.
 */
async function autoEstablishTrustlines(
  wallet: { id: string; stellarPublicKey: string; encryptedSecret: string },
  assets: readonly PaymentAsset[],
): Promise<void> {
  for (const asset of assets) {
    const { available } = await getAssetBalance(db, wallet.id, "XLM");
    if (available.lessThan(dec(TRUSTLINE_XLM_REQUIREMENT))) return; // not funded enough (yet)
    try {
      await walletService.establishTrustline({ encryptedSecret: wallet.encryptedSecret, asset });
      await markTrustlineEstablished(wallet.id, asset);
    } catch (err) {
      console.error("[deposit-poll] auto-trustline failed", {
        walletId: wallet.id,
        asset,
        error: (err as Error).message,
      });
    }
  }
}

export async function syncWalletDeposits(walletId: string): Promise<{
  balanceXlm: Decimal;
  balances: Record<string, Decimal>;
  newDeposits: number;
}> {
  const wallet = await db.custodialWallet.findUniqueOrThrow({ where: { id: walletId } });
  const assets = creditableAssets();
  const cursor = (await redis.get(cursorKey(walletId))) ?? undefined;
  const { items, cursor: newCursor } = await walletService.listIncomingPayments(
    wallet.stellarPublicKey,
    cursor,
    assets,
  );

  let newDeposits = 0;

  for (const item of items) {
    // Idempotent: stellarTxHash is @unique on WalletTransaction.
    const exists = await db.walletTransaction.findUnique({ where: { stellarTxHash: item.txHash } });
    if (exists) continue;
    const amount = dec(item.amount.toString());
    try {
      await db.$transaction(async (tx) => {
        const after = await creditAsset(tx, walletId, item.asset, amount);
        await tx.walletTransaction.create({
          data: {
            walletId,
            type: "PREFUND_DEPOSIT",
            asset: item.asset,
            amount: amount.toFixed(7),
            balanceAfter: after.toFixed(7),
            stellarTxHash: item.txHash,
            memo: `deposit from ${item.from}`,
          },
        });
      });
      newDeposits++;
    } catch (err) {
      // Concurrent insert of the same txHash → ignore (already credited).
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }

  // A trustline can appear without any payment arriving (that's the whole point:
  // it must exist *before* the asset can be received), so it can't be inferred
  // from the payment stream — ask Horizon. Only when an issued asset is enabled,
  // to keep XLM-only deployments at exactly one Horizon call per sync.
  const issued = assets.filter(isIssuedAsset);
  if (issued.length > 0) {
    const onChain = await walletService.getBalances(wallet.stellarPublicKey, issued);
    const missing: PaymentAsset[] = [];
    for (const b of onChain) {
      if (b.trustline) await markTrustlineEstablished(walletId, b.asset);
      else missing.push(b.asset);
    }
    if (missing.length > 0) await autoEstablishTrustlines(wallet, missing);
  }

  if (newCursor) await redis.set(cursorKey(walletId), newCursor);
  await db.custodialWallet.update({ where: { id: walletId }, data: { lastSyncedAt: new Date() } });

  const balances: Record<string, Decimal> = {};
  for (const b of await getAssetBalances(db, walletId, assets)) balances[b.asset] = b.cached;
  return { balanceXlm: balances.XLM ?? dec("0"), balances, newDeposits };
}

export async function processDepositPollJob(): Promise<void> {
  const wallets = await db.custodialWallet.findMany({ select: { id: true } });
  for (const w of wallets) {
    try {
      await syncWalletDeposits(w.id);
    } catch (err) {
      console.error("[deposit-poll] wallet sync failed", {
        walletId: w.id,
        error: (err as Error).message,
      });
    }
  }
}
