import { clsx } from "clsx";
import type { PaymentStatus } from "@/generated/prisma";

type Tone = "settled" | "pending" | "failed";
const TONE: Record<Tone, { chip: string; dot: string; pulse?: boolean }> = {
  settled: { chip: "bg-primary/10 text-primary", dot: "bg-primary" },
  pending: { chip: "bg-secondary/10 text-secondary", dot: "bg-secondary", pulse: true },
  failed: { chip: "bg-error/10 text-error", dot: "bg-error" },
};

// Map every PaymentStatus to a tone + human label.
function classify(status: string): { tone: Tone; label: string } {
  if (status === "SETTLED") return { tone: "settled", label: "Settled" };
  if (status === "FAILED") return { tone: "failed", label: "Failed" };
  if (status === "REFUNDED") return { tone: "settled", label: "Refunded" };
  return { tone: "pending", label: "Pending" }; // CREATED..PAYOUT_SUBMITTED, REFUND_PENDING
}

export function StatusBadge({
  status,
  label,
}: {
  status: PaymentStatus | "SETTLED" | "PENDING" | "FAILED";
  label?: string;
}) {
  const c = classify(status);
  const tone = TONE[c.tone];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-stack-sm rounded-full px-3 py-1 text-label-md uppercase",
        tone.chip,
      )}
    >
      <span
        data-testid="status-dot"
        aria-hidden
        className={clsx("h-1.5 w-1.5 rounded-full", tone.dot, tone.pulse && "animate-status-pulse")}
      />
      {label ?? c.label}
    </span>
  );
}
