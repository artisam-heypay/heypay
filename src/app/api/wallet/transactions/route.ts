// src/app/api/wallet/transactions/route.ts
import { z } from "zod";
import { route, json, parseQuery } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { notFound } from "@/lib/errors";

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = route(async (req) => {
  const user = await requireUser();
  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");
  const { cursor, limit } = parseQuery(req, querySchema);

  const rows = await db.walletTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((t) => ({
    id: t.id,
    type: t.type,
    asset: t.asset,
    amount: t.amount.toFixed(7),
    balanceAfter: t.balanceAfter.toFixed(7),
    stellarTxHash: t.stellarTxHash,
    paymentId: t.paymentId,
    memo: t.memo,
    createdAt: t.createdAt.toISOString(),
  }));
  return json({ items, nextCursor: hasMore ? rows[limit - 1]!.id : null });
});
