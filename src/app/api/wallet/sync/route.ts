// src/app/api/wallet/sync/route.ts
import { route, json } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { db } from "@/server/db";
import { syncWalletDeposits } from "@/server/queue/jobs/deposit-poller";
import { notFound } from "@/lib/errors";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");
  const { balanceXlm, balances } = await syncWalletDeposits(wallet.id);
  return json({
    balanceXlm: balanceXlm.toFixed(7),
    balances: Object.fromEntries(Object.entries(balances).map(([a, v]) => [a, v.toFixed(7)])),
  });
});
