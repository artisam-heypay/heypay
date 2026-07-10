import { route, json } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { displayPhp } from "@/lib/money";
import { enabledAssets } from "@/lib/assets";
import { getAssetRate } from "@/server/payments/rate";
import { getAssetBalances } from "@/server/wallet/balances";
import { isAssetConfigured } from "@/server/stellar/assets";
import { notFound } from "@/lib/errors";

export const GET = route(async () => {
  const user = await requireUser();
  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");

  const assets = enabledAssets().filter(isAssetConfigured);
  const balances = await getAssetBalances(db, wallet.id, assets);

  const rows = await Promise.all(
    balances.map(async (b) => {
      const rate = await getAssetRate(b.asset);
      return {
        asset: b.asset,
        balance: b.cached.toFixed(7),
        reserved: b.reserved.toFixed(7),
        available: b.available.toFixed(7),
        approxPhp: rate ? displayPhp(b.available.times(rate)) : "0.00",
        trustlineEstablishedAt: b.trustlineEstablishedAt?.toISOString() ?? null,
        canReceive: b.canReceive,
      };
    }),
  );

  const xlm = rows.find((r) => r.asset === "XLM");

  return json({
    publicKey: wallet.stellarPublicKey,
    assets: rows,
    // Flat XLM fields kept for clients that predate multi-asset support.
    balanceXlm: xlm?.balance ?? "0.0000000",
    reservedXlm: xlm?.reserved ?? "0.0000000",
    availableXlm: xlm?.available ?? "0.0000000",
    approxPhp: xlm?.approxPhp ?? "0.00",
  });
});
