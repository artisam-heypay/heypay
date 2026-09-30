// src/server/payments/rate.ts
import "server-only";
import { dec, Decimal } from "@/lib/money";
import type { PaymentAsset } from "@/lib/assets";
import { db } from "@/server/db";
import { rail } from "@/server/rails";

// Any amount prices the pair; the rate is per unit.
const RATE_PROBE_PHP = dec("100");

/**
 * How long a persisted rate is served before we ask the rail again. Kept in step
 * with the dashboard's 15s poll so balances follow the market; the snapshot is
 * shared across users, so the rail still sees at most one probe per window.
 */
const RATE_TTL_MS = Number(process.env.RATE_SNAPSHOT_TTL_MS ?? 15_000);

/** Marks snapshots written by a display probe rather than by a real quote. */
const PROBE_SUFFIX = ":probe";

type Snapshot = { rate: Decimal; fetchedAt: Date };

async function latestSnapshot(asset: PaymentAsset): Promise<Snapshot | null> {
  const row = await db.exchangeRateSnapshot.findFirst({
    where: { pair: `${asset}PHP` },
    orderBy: { fetchedAt: "desc" },
    select: { rate: true, fetchedAt: true },
  });
  return row ? { rate: dec(row.rate.toString()), fetchedAt: row.fetchedAt } : null;
}

async function probeRail(asset: PaymentAsset): Promise<{ rate: Decimal; source: string } | null> {
  try {
    const quote = await rail.getQuote({ sell: asset, buy: "PHP", phpAmount: RATE_PROBE_PHP });
    return { rate: quote.rate, source: quote.source };
  } catch {
    return null; // price source down or refusing; the caller falls back to the snapshot
  }
}

/**
 * Reference `asset`→PHP rate (1 unit = N PHP) for approximate balance display.
 *
 * Reads a persisted ExchangeRateSnapshot first and serves it while it is fresh,
 * so rendering a wallet costs a DB read rather than a rail round-trip per token.
 * Once stale, it re-probes the rail and persists the result.
 *
 * If the probe fails it falls back to the stale snapshot: a rate from minutes
 * ago is a far better answer than none, because a null rate hides the token's
 * value entirely and drops it out of the portfolio total. Only an asset that has
 * never been priced — no snapshot, no successful probe — returns null.
 */
export async function getAssetRate(asset: PaymentAsset): Promise<Decimal | null> {
  const snapshot = await latestSnapshot(asset);
  const isFresh = snapshot !== null && Date.now() - snapshot.fetchedAt.getTime() < RATE_TTL_MS;
  if (isFresh) return snapshot.rate;

  // A rail that cannot trade the pair cannot price it. Serving a stale rate for
  // an asset the rail has stopped supporting would imply it is still sellable.
  if (!rail.supportsAsset(asset)) return null;

  const probed = await probeRail(asset);
  if (probed === null) return snapshot?.rate ?? null;

  await db.exchangeRateSnapshot
    .create({
      data: {
        pair: `${asset}PHP`,
        rate: probed.rate.toFixed(8),
        source: `${probed.source}${PROBE_SUFFIX}`,
      },
    })
    .catch(() => {
      // Caching is best-effort; a failed write must not fail the page.
    });
  return probed.rate;
}

/** Back-compat helper for the XLM leg. */
export function getXlmPhpRate(): Promise<Decimal | null> {
  return getAssetRate("XLM");
}
