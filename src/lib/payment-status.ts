import type { PaymentStatus } from "@/generated/prisma";

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

export function statusLabel(s: PaymentStatus): string {
  return LABELS[s];
}

export function statusTone(s: PaymentStatus): StatusTone {
  if (s === "SETTLED") return "settled";
  if (s === "FAILED" || s === "REFUND_PENDING" || s === "REFUNDED") return "failed";
  if (s === "CREATED" || s === "QUOTED") return "neutral";
  return "pending";
}
