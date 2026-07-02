import { clsx } from "clsx";
import type { PaymentStatus } from "@/generated/prisma/client";
import { statusLabel, statusTone, type StatusTone } from "@/lib/payment-status";

const TONE: Record<StatusTone, { chip: string; dot: string; pulse: boolean }> = {
  settled: { chip: "bg-primary/10 text-primary", dot: "bg-primary", pulse: false },
  pending: { chip: "bg-secondary/10 text-secondary", dot: "bg-secondary", pulse: true },
  failed: { chip: "bg-error/10 text-error", dot: "bg-error", pulse: false },
  neutral: {
    chip: "bg-surface-container-high text-on-surface-variant",
    dot: "bg-outline",
    pulse: false,
  },
};

export function StatusBadge({
  status,
  label,
}: {
  status: PaymentStatus | "SETTLED" | "PENDING" | "FAILED" | string;
  label?: string;
}) {
  const tone = TONE[statusTone(status)];
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
      {label ?? statusLabel(status)}
    </span>
  );
}
