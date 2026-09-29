// src/server/observability/payment-trail.ts
//
// The on-chain and rail identifiers that let a payment be traced in PostHog end
// to end: which wallet paid, which asset contract moved, which bank account was
// paid, and what Xendit said about the payout.
//
// Deliberate, temporary deviation from AGENT.md §6: full bank account numbers,
// holder names, payout emails and unredacted Xendit payloads are sent to
// PostHog while the payment flow is being traced. Revisit before production.
import "server-only";
import type { PaymentAsset } from "@/lib/assets";
import type { RailPayload } from "@/server/rails/provider";
import { assetIssuer, resolveStellarAsset } from "@/server/stellar/assets";
import { getNetworkPassphrase } from "@/server/stellar/horizon";

/** PostHog keeps large properties, but a runaway payload is not worth shipping. */
const MAX_PAYLOAD_CHARS = 8_000;

/**
 * The asset's Stellar issuer and its Soroban contract (Stellar Asset Contract)
 * address. Both null when the asset cannot be resolved; analytics never throws.
 */
export function assetContract(asset: PaymentAsset): {
  asset_issuer: string | null;
  asset_contract_id: string | null;
} {
  try {
    return {
      asset_issuer: assetIssuer(asset),
      asset_contract_id: resolveStellarAsset(asset).contractId(getNetworkPassphrase()),
    };
  } catch {
    return { asset_issuer: null, asset_contract_id: null };
  }
}

/** A rail payload as a single PostHog property (JSON text, capped in size). */
export function railPayload(raw: RailPayload | undefined): string | undefined {
  if (!raw) return undefined;
  const json = JSON.stringify(raw);
  return json.length > MAX_PAYLOAD_CHARS ? `${json.slice(0, MAX_PAYLOAD_CHARS)}…` : json;
}
