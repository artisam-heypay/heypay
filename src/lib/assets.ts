// src/lib/assets.ts
//
// Payment-asset feature flag (SPEC §1 "USDT/USDC are future scope", §4 enum
// `PaymentAsset { XLM USDC USDT }`). The three assets are modeled in the DB, but
// only the ones listed here are accepted by the payment pipeline. v1 ships XLM
// only; enabling USDC/USDT is a config change once the Stellar/PDAX legs support
// them — no schema migration required.
//
// Configure via `PAYMENT_ASSETS` (comma-separated, case-insensitive), e.g.
//   PAYMENT_ASSETS=XLM,USDC
// Empty/unset falls back to XLM only.
import { badRequest } from "@/lib/errors";

export type PaymentAsset = "XLM" | "USDC" | "USDT";

const ALL_ASSETS: readonly PaymentAsset[] = ["XLM", "USDC", "USDT"];
const DEFAULT_ENABLED: readonly PaymentAsset[] = ["XLM"];

function isPaymentAsset(v: string): v is PaymentAsset {
  return (ALL_ASSETS as readonly string[]).includes(v);
}

/** The assets accepted by the payment pipeline, per `PAYMENT_ASSETS`. */
export function enabledAssets(env = process.env.PAYMENT_ASSETS): PaymentAsset[] {
  if (!env) return [...DEFAULT_ENABLED];
  const parsed = env
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(isPaymentAsset);
  return parsed.length > 0 ? [...new Set(parsed)] : [...DEFAULT_ENABLED];
}

export function isAssetEnabled(asset: PaymentAsset, env = process.env.PAYMENT_ASSETS): boolean {
  return enabledAssets(env).includes(asset);
}

/** Throws `badRequest` (400) if `asset` is not enabled; use before creating a Payment. */
export function assertAssetEnabled(asset: PaymentAsset, env = process.env.PAYMENT_ASSETS): void {
  if (!isAssetEnabled(asset, env)) {
    throw badRequest(`Payment asset ${asset} is not enabled.`, {
      asset,
      enabled: enabledAssets(env),
    });
  }
}
