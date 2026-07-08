// src/server/payments/rate.ts
import "server-only";
import { dec, Decimal } from "@/lib/money";
import { db } from "@/server/db";
import { rail } from "@/server/rails";

// Amount used for the live fallback quote. Some rails (PDAX Institution) reject
// probes below their minimum trade size — a ₱1 quote fails with "below IMM
// minimum" — so probe well above any plausible minimum.
const RATE_PROBE_PHP = dec("100");

/**
 * Reference XLM→PHP rate (1 XLM = N PHP) for approximate balance display.
 *
 * Prefers the most recent persisted ExchangeRateSnapshot (written on every real
 * quote in `createQuote`): it's a cheap DB read and always available once any
 * payment has been quoted. Falls back to a live rail quote at an above-minimum
 * amount only when no snapshot exists. Returns null when no rate is obtainable,
 * so callers can render "≈ ₱0.00" rather than fail the page.
 */
export async function getXlmPhpRate(): Promise<Decimal | null> {
  const snap = await db.exchangeRateSnapshot.findFirst({
    where: { pair: "XLMPHP" },
    orderBy: { fetchedAt: "desc" },
    select: { rate: true },
  });
  if (snap) return dec(snap.rate.toString());

  try {
    const quote = await rail.getQuote({ sell: "XLM", buy: "PHP", phpAmount: RATE_PROBE_PHP });
    return quote.rate;
  } catch {
    return null;
  }
}
