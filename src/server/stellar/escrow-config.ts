// src/server/stellar/escrow-config.ts
//
// When the Soroban escrow applies and what it costs, kept apart from the escrow
// client so quote/confirm code can ask without bundling the contract bindings.
import "server-only";
import { dec, type Decimal } from "@/lib/money";
import type { PaymentAsset } from "@/lib/assets";
import { captureException } from "@/server/observability/error-tracking";

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

/** The contract stores the window as a u32. */
const MAX_TIMEOUT_LEDGERS = 0xffff_ffff;

// The bad value last reported, so a typo is reported once and not on every deposit.
let reportedTimeout: string | null = null;

/**
 * The payer self-refund window the app keeps the contract set to, in ledgers
 * (about 5 seconds each), or null to leave the contract's own window alone
 * (17,280 ledgers, ~24h, unless changed). A short window is for testing the
 * timeout refund: once it passes, the payer can take the crypto back while the
 * payout is still on its way. A bad ESCROW_TIMEOUT_LEDGERS is ignored rather
 * than failing payments.
 */
export function escrowTimeoutLedgers(): number | null {
  const raw = process.env.ESCROW_TIMEOUT_LEDGERS?.trim();
  if (!raw) return null;
  if (/^[1-9]\d*$/.test(raw) && Number(raw) <= MAX_TIMEOUT_LEDGERS) return Number(raw);
  if (reportedTimeout !== raw) {
    reportedTimeout = raw;
    captureException(new Error(`ESCROW_TIMEOUT_LEDGERS is not a positive ledger count: ${raw}`), {
      source: "escrow.config",
    });
  }
  return null;
}
