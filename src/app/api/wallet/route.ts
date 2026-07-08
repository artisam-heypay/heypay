// src/app/api/wallet/route.ts
import { route, json } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { dec, availableXlm, displayPhp } from "@/lib/money";
import { getXlmPhpRate } from "@/server/payments/rate";
import { notFound } from "@/lib/errors";

export const GET = route(async () => {
  const user = await requireUser();
  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");

  const balance = dec(wallet.cachedXlmBalance.toString());
  const reserved = dec(wallet.reservedXlm.toString());
  const available = availableXlm(balance, reserved);

  const rate = await getXlmPhpRate();
  const approxPhp = rate ? displayPhp(available.times(rate)) : "0.00";

  return json({
    publicKey: wallet.stellarPublicKey,
    balanceXlm: balance.toFixed(7),
    reservedXlm: reserved.toFixed(7),
    availableXlm: available.toFixed(7),
    approxPhp,
  });
});
