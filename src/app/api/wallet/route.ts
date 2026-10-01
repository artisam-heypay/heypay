import { route, json } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { displayPhp } from "@/lib/money";
import { getHoldings } from "@/server/payer/holdings";
import { notFound } from "@/lib/errors";

export const GET = route(async () => {
  const user = await requireUser();
  const holdings = await getHoldings(user.id);
  if (!holdings) throw notFound("wallet not found");

  const assets = holdings.tokens.map((t) => ({
    asset: t.asset,
    balance: t.balance.toFixed(7),
    reserved: t.reserved.toFixed(7),
    available: t.available.toFixed(7),
    rate: t.rate?.toFixed(8) ?? null,
    // Numeric, for arithmetic. `approxPhp` below stays a display string.
    valuePhp: t.valuePhp?.toFixed(2) ?? null,
    approxPhp: t.valuePhp ? displayPhp(t.valuePhp) : null,
    canReceive: t.canReceive,
  }));

  const xlm = assets.find((a) => a.asset === "XLM");

  return json({
    publicKey: holdings.publicKey,
    assets,
    totalPhp: holdings.totalPhp.toFixed(2),
    hasUnpricedBalance: holdings.hasUnpricedBalance,
    // Flat XLM fields kept for clients that predate multi-asset support.
    balanceXlm: xlm?.balance ?? "0.0000000",
    reservedXlm: xlm?.reserved ?? "0.0000000",
    availableXlm: xlm?.available ?? "0.0000000",
    approxPhp: xlm?.approxPhp ?? "0.00",
  });
});
