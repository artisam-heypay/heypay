// src/server/queue/jobs/deposit-poller.ts
import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { redis } from "@/server/redis";
import { walletService } from "@/server/stellar/wallet";
import { dec, Decimal } from "@/lib/money";

const cursorKey = (walletId: string) => `horizon:cursor:${walletId}`;

export async function syncWalletDeposits(
  walletId: string,
): Promise<{ balanceXlm: Decimal; newDeposits: number }> {
  const wallet = await db.custodialWallet.findUniqueOrThrow({ where: { id: walletId } });
  const cursor = (await redis.get(cursorKey(walletId))) ?? undefined;
  const { items, cursor: newCursor } = await walletService.listIncomingPayments(
    wallet.stellarPublicKey,
    cursor,
  );

  let newDeposits = 0;
  let balance = dec(wallet.cachedXlmBalance.toString());

  for (const item of items) {
    // Idempotent: stellarTxHash is @unique on WalletTransaction.
    const exists = await db.walletTransaction.findUnique({ where: { stellarTxHash: item.txHash } });
    if (exists) continue;
    const amount = dec(item.amountXlm.toString());
    const after = balance.plus(amount);
    try {
      await db.$transaction(async (tx) => {
        await tx.walletTransaction.create({
          data: {
            walletId,
            type: "PREFUND_DEPOSIT",
            amountXlm: amount.toFixed(7),
            balanceAfter: after.toFixed(7),
            stellarTxHash: item.txHash,
            memo: `deposit from ${item.from}`,
          },
        });
        await tx.custodialWallet.update({
          where: { id: walletId },
          data: { cachedXlmBalance: after.toFixed(7) },
        });
      });
      balance = after;
      newDeposits++;
    } catch (err) {
      // Concurrent insert of the same txHash → ignore (already credited).
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }

  if (newCursor) await redis.set(cursorKey(walletId), newCursor);
  await db.custodialWallet.update({ where: { id: walletId }, data: { lastSyncedAt: new Date() } });
  return { balanceXlm: balance, newDeposits };
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
