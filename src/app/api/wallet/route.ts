import { route, json } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { dec, availableXlm, displayPhp } from "@/lib/money";
import { rail } from "@/server/rails";
import { notFound } from "@/lib/errors";

export const GET = route(async () => {
  const user = await requireUser();
  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");

  const balance = dec(wallet.cachedXlmBalance.toString());
  const reserved = dec(wallet.reservedXlm.toString());
  const available = availableXlm(balance, reserved);

  let approxPhp = "0.00";
  try {
    const quote = await rail.getQuote({ sell: "XLM", buy: "PHP", phpAmount: dec("1") });
    approxPhp = displayPhp(available.times(quote.rate));
  } catch {
    // Rate unavailable → omit approximation rather than failing the balance read.
  }

  return json({
    publicKey: wallet.stellarPublicKey,
    balanceXlm: balance.toFixed(7),
    reservedXlm: reserved.toFixed(7),
    availableXlm: available.toFixed(7),
    approxPhp,
  });
});
