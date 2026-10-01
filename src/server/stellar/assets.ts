// src/server/stellar/assets.ts
//
// Maps a `PaymentAsset` onto the Stellar asset it represents on the configured
// network.
//
// XLM is the native asset. USDC/USDT are issued assets identified by
// `code:issuer` — the same code from a different issuer is a *different*, and
// possibly worthless, asset. Issuers therefore come from config, never from a
// constant baked into this file:
//
//   USDC_ASSET_ISSUER=G...
//   USDT_ASSET_ISSUER=G...
//
// They differ per network (mainnet vs testnet), and the set of issuers that
// actually exist differs too: Circle's USDC is well-supported on Stellar
// mainnet, while Tether's native Stellar USDT has been intermittent. On testnet
// there is no canonical issuer at all — mint your own with
// `scripts/stellar-issue-test-asset.mjs` and point `USDT_ASSET_ISSUER` at it.
//
// Enabling an asset in PAYMENT_ASSETS without configuring its issuer is a
// deployment error, and fails loudly the first time the asset is resolved
// rather than silently paying to a dead issuer.
import "server-only";
import { Asset } from "@stellar/stellar-sdk";
import { isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { serverError } from "@/lib/errors";

const ISSUER_ENV_KEY: Record<Exclude<PaymentAsset, "XLM">, string> = {
  USDC: "USDC_ASSET_ISSUER",
  USDT: "USDT_ASSET_ISSUER",
};

/**
 * Testnet-only fallback issuers, so a dev machine works with no extra config.
 *
 * Both are issued by the account whose `home_domain` is `centre.io` (Circle's
 * Centre Consortium) on testnet — verified against Horizon: it holds 46k+
 * authorized USDC trustlines, making it the de-facto testnet USDC issuer, and it
 * issues a test USDT as well. `auth_required` is false, so any wallet may add a
 * trustline and receive.
 *
 * Deliberately NOT applied on mainnet: there, a wrong issuer means real money
 * sent to a worthless lookalike, so mainnet must name its issuer explicitly.
 */
const TESTNET_ISSUER: Record<Exclude<PaymentAsset, "XLM">, string> = {
  USDC: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  USDT: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

function isMainnet(): boolean {
  return process.env.STELLAR_NETWORK === "mainnet";
}

/** Stellar asset code as it appears on-chain (`balances[].asset_code`). */
export function assetCode(asset: PaymentAsset): string {
  return asset;
}

/**
 * The issuer account for an issued asset: the configured one, else the testnet
 * default, else null. Returns null on mainnet whenever the env var is unset.
 */
export function assetIssuer(asset: PaymentAsset): string | null {
  if (!isIssuedAsset(asset)) return null;
  const key = ISSUER_ENV_KEY[asset as Exclude<PaymentAsset, "XLM">];
  const value = process.env[key]?.trim();
  if (value) return value;
  if (isMainnet()) return null;
  return TESTNET_ISSUER[asset as Exclude<PaymentAsset, "XLM">];
}

/** True when the asset can actually be used: native, or issued with an issuer configured. */
export function isAssetConfigured(asset: PaymentAsset): boolean {
  return !isIssuedAsset(asset) || assetIssuer(asset) !== null;
}

/**
 * The `Asset` to use in Stellar operations. Throws for an issued asset whose
 * issuer is not configured — better a 500 at the first payment than funds sent
 * to a bogus `code:issuer` pair.
 */
export function resolveStellarAsset(asset: PaymentAsset): Asset {
  if (!isIssuedAsset(asset)) return Asset.native();
  const issuer = assetIssuer(asset);
  if (!issuer) {
    const key = ISSUER_ENV_KEY[asset as Exclude<PaymentAsset, "XLM">];
    throw serverError(`${asset} is enabled on mainnet but ${key} is not set.`);
  }
  return new Asset(assetCode(asset), issuer);
}

/** Inverse of {@link resolveStellarAsset} for Horizon records; null when unrecognised. */
export function matchPaymentAsset(
  record: { asset_type?: string; asset_code?: string; asset_issuer?: string },
  candidates: readonly PaymentAsset[],
): PaymentAsset | null {
  if (record.asset_type === "native") {
    return candidates.includes("XLM") ? "XLM" : null;
  }
  if (!record.asset_code || !record.asset_issuer) return null;
  for (const candidate of candidates) {
    if (!isIssuedAsset(candidate)) continue;
    if (record.asset_code !== assetCode(candidate)) continue;
    if (record.asset_issuer !== assetIssuer(candidate)) continue;
    return candidate;
  }
  return null;
}

/**
 * XLM a wallet must hold before it can add one more trustline: each trustline
 * raises the account's minimum reserve by one base reserve (0.5 XLM), and the
 * changeTrust transaction itself costs a base fee. The extra headroom keeps the
 * account above its new minimum rather than exactly at it.
 */
export const TRUSTLINE_XLM_REQUIREMENT = "1.0";
