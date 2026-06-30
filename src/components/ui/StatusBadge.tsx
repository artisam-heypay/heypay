import { clsx } from "clsx";
import type { PaymentStatus } from "@/generated/prisma";
import { statusLabel, statusTone, type StatusTone } from "@/lib/payment-status";

const TONE: Record<StatusTone, { chip: string; dot: string; pulse?: boolean }> = {
  settled: { chip: "bg-primary/10 text-primary", dot: "bg-primary" },
  pending: { chip: "bg-secondary/10 text-secondary", dot: "bg-secondary", pulse: true },
  failed: { chip: "bg-error/10 text-error", dot: "bg-error" },
  neutral: { chip: "bg-surface-container-high text-on-surface-variant", dot: "bg-outline" },
};

// Convenience aliases used by some callers that don't have a real PaymentStatus.
function classify(status: string): { tone: StatusTone; label: string } {
  if (status === "PENDING") return { tone: "pending", label: "Pending" };
  return { tone: statusTone(status as PaymentStatus), label: statusLabel(status as PaymentStatus) };
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
