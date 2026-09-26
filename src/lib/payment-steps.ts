import type { PaymentStatus } from "@/generated/prisma/client";

export const PAYMENT_STEPS: { key: PaymentStatus; label: string }[] = [
  { key: "AUTHORIZED", label: "Payment authorized" },
  { key: "STELLAR_SUBMITTED", label: "Sending crypto to HeyPay" },
  { key: "STELLAR_CONFIRMED", label: "Confirmed on Stellar" },
  { key: "PAYOUT_SUBMITTED", label: "Paying the merchant in PHP" },
  { key: "SETTLED", label: "Settled" },
];

const ORDER = PAYMENT_STEPS.map((s) => s.key);

export function stepState(
  stepKey: PaymentStatus,
  current: PaymentStatus,
): "done" | "active" | "todo" {
  if (current === "FAILED" || current === "REFUND_PENDING" || current === "REFUNDED") {
    return ORDER.indexOf(stepKey) < ORDER.indexOf("STELLAR_SUBMITTED") ? "done" : "todo";
  }
  const ci = ORDER.indexOf(current);
  const si = ORDER.indexOf(stepKey);
  if (si < ci) return "done";
  if (si === ci) return current === "SETTLED" ? "done" : "active";
  return "todo";
}
