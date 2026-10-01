import Link from "next/link";
import type { EarningsRange } from "@/server/merchant/service";

const OPTIONS: { value: EarningsRange; label: string; long: string }[] = [
  { value: "1d", label: "1D", long: "Last 24 hours" },
  { value: "1w", label: "1W", long: "Last 7 days" },
  { value: "1m", label: "1M", long: "Last 30 days" },
  { value: "all", label: "All", long: "All time" },
];

/** Date-range presets; the choice lives in the URL so it survives refresh and sharing. */
export function RangeFilter({ current }: { current: EarningsRange }) {
  return (
    <nav
      aria-label="Date range"
      className="inline-flex self-start rounded-full bg-surface-container p-1"
    >
      {OPTIONS.map((o) => {
        const active = o.value === current;
        return (
          <Link
            key={o.value}
            href={`?range=${o.value}`}
            scroll={false}
            aria-current={active ? "page" : undefined}
            aria-label={o.long}
            title={o.long}
            className={`min-h-9 min-w-12 rounded-full px-stack-md py-1.5 text-center text-body-sm font-semibold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 ${
              active
                ? "bg-surface-container-lowest text-on-surface shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
