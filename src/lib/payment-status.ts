import type { PaymentStatus } from "@/generated/prisma/client";

export type StatusTone = "settled" | "pending" | "failed" | "neutral";

const LABELS: Record<PaymentStatus, string> = {
  CREATED: "Created",
  QUOTED: "Quoted",
  AUTHORIZED: "Authorized",
  STELLAR_SUBMITTED: "Submitting",
  STELLAR_CONFIRMED: "Confirmed",
  PDAX_TRADING: "Pending Trade",
  PDAX_TRADED: "Traded",
  PAYOUT_SUBMITTED: "Paying Out",
  SETTLED: "Settled",
  FAILED: "Failed",
  REFUND_PENDING: "Refund Pending",
  REFUNDED: "Refunded",
};

export function statusLabel(s: PaymentStatus | string): string {
  return LABELS[s as PaymentStatus] ?? String(s);
}

export function statusTone(s: PaymentStatus | string): StatusTone {
  if (s === "SETTLED" || s === "REFUNDED") return "settled";
  if (s === "FAILED" || s === "REFUND_PENDING") return "failed";
  if (s === "CREATED" || s === "QUOTED") return "neutral";
  return "pending";
}
