// src/lib/assets.ts
//
// Payment-asset feature flag (SPEC §1 "USDT/USDC are future scope", §4 enum
// `PaymentAsset { XLM USDC USDT }`). The three assets are modeled in the DB, but
// only the ones listed here are accepted by the payment pipeline. v1 shipped XLM
// only; enabling USDC/USDT is a config change — the Stellar and rail legs are
// asset-parametrized (see `src/server/stellar/assets.ts`, `src/server/rails`).
//
// Configure via `PAYMENT_ASSETS` (comma-separated, case-insensitive), e.g.
//   PAYMENT_ASSETS=XLM,USDT
// Empty/unset falls back to XLM only.
//
// XLM is Stellar's native asset. USDC/USDT are *issued* assets (`code:issuer`):
// an account must hold a trustline to the issuer before it can receive them, and
// each trustline raises the account's minimum XLM reserve. Stellar transaction
// fees are always paid in XLM regardless of the asset being moved — so a USDT
// payment still debits a small XLM network fee.
import { badRequest } from "@/lib/errors";

export type PaymentAsset = "XLM" | "USDC" | "USDT";

const ALL_ASSETS: readonly PaymentAsset[] = ["XLM", "USDC", "USDT"];
const DEFAULT_ENABLED: readonly PaymentAsset[] = ["XLM"];

/** Assets that exist as `code:issuer` on Stellar and therefore need a trustline. */
const ISSUED_ASSETS: readonly PaymentAsset[] = ["USDC", "USDT"];

export function isPaymentAsset(v: string): v is PaymentAsset {
  return (ALL_ASSETS as readonly string[]).includes(v);
}

/** True for non-native assets, which require a trustline before they can be held. */
export function isIssuedAsset(asset: PaymentAsset): boolean {
  return (ISSUED_ASSETS as readonly PaymentAsset[]).includes(asset);
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

/** Parse an untrusted asset string, defaulting to XLM. Throws if unknown or disabled. */
export function parseEnabledAsset(
  value: string | null | undefined,
  env = process.env.PAYMENT_ASSETS,
): PaymentAsset {
  const raw = (value ?? "XLM").trim().toUpperCase();
  if (!isPaymentAsset(raw)) throw badRequest(`Unknown payment asset ${raw}.`);
  assertAssetEnabled(raw, env);
  return raw;
}
