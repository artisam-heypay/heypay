// src/server/payments/rate.ts
import "server-only";
import { dec, Decimal } from "@/lib/money";
import type { PaymentAsset } from "@/lib/assets";
import { db } from "@/server/db";
import { rail } from "@/server/rails";

// Amounts tried, in order, for the live fallback quote. Rails enforce a minimum
// trade size *per pair*: PDAX prices XLMPHP and USDCPHP at ₱100 but rejects
// USDTPHP below roughly ₱500 ("Order quantity is less than minimum required
// quantity"). Escalating means a pair with a higher floor still yields a rate
// instead of silently reporting none, while cheap pairs still cost one call.
const RATE_PROBE_PHP = [dec("100"), dec("500"), dec("2000")];

/**
 * Reference `asset`→PHP rate (1 unit = N PHP) for approximate balance display.
 *
 * Prefers the most recent persisted ExchangeRateSnapshot (written on every real
 * quote in `createQuote`): it's a cheap DB read and always available once any
 * payment has been quoted in that asset. Falls back to a live rail quote at an
 * above-minimum amount only when no snapshot exists. Returns null when no rate
 * is obtainable, so callers can render "≈ ₱0.00" rather than fail the page.
 */
export async function getAssetRate(asset: PaymentAsset): Promise<Decimal | null> {
  const snap = await db.exchangeRateSnapshot.findFirst({
    where: { pair: `${asset}PHP` },
    orderBy: { fetchedAt: "desc" },
    select: { rate: true },
  });
  if (snap) return dec(snap.rate.toString());

  if (!rail.supportsAsset(asset)) return null;
  for (const phpAmount of RATE_PROBE_PHP) {
    try {
      const quote = await rail.getQuote({ sell: asset, buy: "PHP", phpAmount });
      return quote.rate;
    } catch {
      // Below this pair's minimum (or a transient rail error) — try a larger probe.
    }
  }
  return null;
}

/** Back-compat helper for the XLM leg. */
export function getXlmPhpRate(): Promise<Decimal | null> {
  return getAssetRate("XLM");
}
