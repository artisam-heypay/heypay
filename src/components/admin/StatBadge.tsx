import type { ReactNode } from "react";

type Tone = "settled" | "pending" | "error" | "neutral";

const TONE: Record<Tone, { chip: string; dot: string }> = {
  settled: { chip: "bg-primary/10 text-primary", dot: "bg-primary" },
  pending: { chip: "bg-secondary/10 text-secondary", dot: "bg-secondary" },
  error: { chip: "bg-error/10 text-error", dot: "bg-error" },
  neutral: { chip: "bg-surface-container-high text-on-surface-variant", dot: "bg-outline" },
};

export function StatBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <span
      className={`inline-flex items-center gap-stack-sm rounded-full px-3 py-1 text-label-md uppercase ${t.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}
