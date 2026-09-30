// src/server/stellar/escrow-config.ts
//
// When the Soroban escrow applies and what it costs, kept apart from the escrow
// client so quote/confirm code can ask without bundling the contract bindings.
import "server-only";
import { dec, type Decimal } from "@/lib/money";
import type { PaymentAsset } from "@/lib/assets";

/**
 * Whether a new payment in `asset` goes through the escrow. D1 escrows XLM only
 * (the deployed contract holds the native XLM SAC); USDC keeps the direct
 * treasury path until D2.
 */
export function escrowAppliesTo(asset: PaymentAsset): boolean {
  return process.env.ESCROW_ENABLED === "true" && asset === "XLM";
}

/**
 * What an escrow deposit is expected to cost in fees, before it runs. A contract
 * call pays a Soroban resource fee far above the classic 100-stroop base fee
 * (~0.106 XLM for a deposit on Testnet), so the quote reserves this much on top
 * of the amount. The payer is debited the real fee once the deposit lands.
 */
export function escrowFeeEstimateXlm(): Decimal {
  return dec(process.env.ESCROW_FEE_ESTIMATE_XLM ?? "0.2");
}
