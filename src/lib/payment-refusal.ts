// src/lib/payment-refusal.ts
//
// The reasons a payment is refused before any money moves that the payer can do
// something about, and what the payer reads for each. The reason travels in the
// error's `details`, so a screen can offer the next step (a button or a link)
// next to the message.
import type { PaymentAsset } from "@/lib/assets";

export type PaymentRefusalReason =
  /** The payer's wallet has no trustline for the asset yet. */
  | "payer_no_trustline"
  /** The payment cannot be taken in this asset: what would hold it holds another. */
  | "asset_mismatch"
  /** The wallet holds less of the asset than the payment needs. */
  | "insufficient_balance"
  /** The wallet holds too little XLM for the network fees. */
  | "insufficient_fee";

const REASONS: readonly PaymentRefusalReason[] = [
  "payer_no_trustline",
  "asset_mismatch",
  "insufficient_balance",
  "insufficient_fee",
];

export type PaymentRefusal = {
  reason: PaymentRefusalReason;
  /** The asset the payment was to be made in. */
  asset: PaymentAsset;
  /** Another asset the payer could use for this payment, when there is one. */
  payWith?: PaymentAsset;
  /** Roughly how much XLM the network fees need, for `insufficient_fee`. */
  feeXlm?: string;
};

/** What the payer reads: what is wrong, then what to do about it. */
export function refusalMessage({ reason, asset, payWith, feeXlm }: PaymentRefusal): string {
  switch (reason) {
    case "payer_no_trustline":
      return `Turn on ${asset} first.`;
    case "asset_mismatch":
      return payWith
        ? `This shop is paid in a different currency. Pay with ${payWith} instead.`
        : "This shop is paid in a different currency.";
    case "insufficient_balance":
      return payWith
        ? `Not enough ${asset} — add more or pay with ${payWith}.`
        : `Not enough ${asset} — add more.`;
    case "insufficient_fee":
      return feeXlm
        ? `Not enough XLM for the network fee — add about ${feeXlm} XLM.`
        : "Not enough XLM for the network fee — add more XLM.";
  }
}

/** A failed request as a screen shows it: the message, and the refusal when it is one. */
export type RefusedRequest = { message: string; refusal: PaymentRefusal | null };

/**
 * Reads an API error body. `refusal` is set only when the body names one of the
 * reasons above; any other error keeps its message, or gets `fallback`.
 */
export function readRefusal(body: unknown, fallback: string): RefusedRequest {
  const error = (body as { error?: { message?: unknown; details?: unknown } } | null)?.error;
  const message = typeof error?.message === "string" ? error.message : fallback;
  const details = error?.details as Partial<PaymentRefusal> | null | undefined;
  const reason = REASONS.find((r) => r === details?.reason);
  if (!reason || typeof details?.asset !== "string") return { message, refusal: null };
  return {
    message,
    refusal: { reason, asset: details.asset, payWith: details.payWith, feeXlm: details.feeXlm },
  };
}
