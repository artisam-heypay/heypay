// src/server/stellar/paths.ts
//
// Stellar DEX path finding, used when the payment rail cannot receive the asset
// the payer is funding with. A path payment converts the asset in the same
// transaction that delivers it, so the rail sees only the asset it accepts and
// the payer's wallet is debited exactly once.
import "server-only";
import { Asset, Horizon } from "@stellar/stellar-sdk";
import { dec, type Decimal } from "@/lib/money";
import type { PaymentAsset } from "@/lib/assets";
import { resolveStellarAsset } from "./assets";
import { getHorizon } from "./horizon";

export type ConversionRoute = {
  /** How much of the source asset is needed to deliver `destAmount`. */
  sourceAmount: Decimal;
  /** Intermediate hops, excluding source and destination. Empty for a direct trade. */
  path: Asset[];
};

type HorizonPathRecord = { source_amount: string; path: HorizonPathAsset[] };
type HorizonPathAsset = { asset_type: string; asset_code?: string; asset_issuer?: string };

function toAsset(a: HorizonPathAsset): Asset {
  return a.asset_type === "native" ? Asset.native() : new Asset(a.asset_code!, a.asset_issuer!);
}

/**
 * Refuse routes that hop through intermediate assets, trading only the direct
 * `from`/`to` order book.
 *
 * Off by default. A hop is not a risk — intermediate assets are never held, the
 * whole chain is atomic, and `destMin`/`sendAmount` bracket the result — and
 * forbidding hops only removes cheaper fills. Exists for operators who want the
 * simplest possible on-chain footprint.
 */
const DIRECT_ONLY = process.env.SETTLEMENT_DIRECT_ONLY === "true";

/**
 * Cheapest route that converts `from` into exactly `destAmount` of `to`.
 *
 * Returns null when the DEX has no route with enough depth — the honest answer
 * for a thin testnet order book. Callers must refuse the payment rather than
 * submit a transaction that would fail on-chain after the payer confirmed.
 */
export async function findConversionRoute(
  from: PaymentAsset,
  to: PaymentAsset,
  destAmount: Decimal,
  server?: Horizon.Server,
): Promise<ConversionRoute | null> {
  const srv = server ?? getHorizon();
  const source = resolveStellarAsset(from);
  const destination = resolveStellarAsset(to);

  let records: HorizonPathRecord[];
  try {
    const page = await srv.strictReceivePaths([source], destination, destAmount.toFixed(7)).call();
    records = page.records as unknown as HorizonPathRecord[];
  } catch {
    return null; // Horizon reports no path as an error on some versions
  }

  const candidates = DIRECT_ONLY ? records.filter((r) => r.path.length === 0) : records;
  if (candidates.length === 0) return null;

  // Cheapest source amount wins: the payer spends less and the rail still
  // receives exactly `destAmount` either way.
  const best = candidates.reduce((a, b) =>
    dec(a.source_amount).lessThanOrEqualTo(dec(b.source_amount)) ? a : b,
  );
  return { sourceAmount: dec(best.source_amount), path: best.path.map(toAsset) };
}
