// src/server/payments/refusal.ts
//
// Builds the error for a payment refused before any money moved, for the cases
// the payer can fix themselves. Quote and confirm throw the same error for the
// same case, so every screen reads one message and one reason.
import "server-only";
import { badRequest, conflict, type AppError } from "@/lib/errors";
import { isAssetEnabled, type PaymentAsset } from "@/lib/assets";
import { Decimal } from "@/lib/money";
import {
  refusalMessage,
  type PaymentRefusal,
  type PaymentRefusalReason,
} from "@/lib/payment-refusal";

/** XLM is the one asset every wallet can hold, so it is the one to fall back on. */
function alternativeTo(asset: PaymentAsset): PaymentAsset | undefined {
  return asset !== "XLM" && isAssetEnabled("XLM") ? "XLM" : undefined;
}

/**
 * `amounts` are added to the error details as 7-decimal strings. A short balance
 * is a conflict (409): the same request succeeds once the wallet is topped up.
 * The other reasons are a bad request (400), like every other refused route.
 */
export function paymentRefused(
  reason: PaymentRefusalReason,
  asset: PaymentAsset,
  amounts: Record<string, Decimal> = {},
): AppError {
  const short = reason === "insufficient_balance" || reason === "insufficient_fee";
  const refusal: PaymentRefusal = {
    reason,
    asset,
    // Fees are XLM for every asset, so another asset does not help a short fee.
    ...(reason !== "insufficient_fee" && { payWith: alternativeTo(asset) }),
    ...(reason === "insufficient_fee" &&
      amounts.requiredXlm && {
        feeXlm: amounts.requiredXlm.toDecimalPlaces(2, Decimal.ROUND_UP).toString(),
      }),
  };
  const details = {
    ...refusal,
    ...Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, v.toFixed(7)])),
  };
  return (short ? conflict : badRequest)(refusalMessage(refusal), details);
}
