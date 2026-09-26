import { dec, displayPhp } from "@/lib/money";
import type { EarningsRange, MerchantEarnings } from "@/server/merchant/service";

const PERIOD: Record<EarningsRange, string | null> = {
  "1d": "vs previous 24 hours",
  "1w": "vs previous week",
  "1m": "vs previous 30 days",
  all: null,
};

export function EarningsCards({ earnings }: { earnings: MerchantEarnings }) {
  const change = earnings.changePct;
  const up = (change ?? 0) >= 0;
  const period = PERIOD[earnings.range];
  return (
    <div className="grid grid-cols-1 gap-stack-lg md:grid-cols-2">
      <div className="tonal-card rounded-xl p-stack-lg">
        <p className="text-label-md uppercase text-on-surface-variant">Total settled</p>
        <p className="mt-stack-sm text-display-lg text-primary">
          {displayPhp(dec(earnings.totalSettledPhp))}
        </p>
        <p className="mt-stack-sm text-body-sm text-on-surface-variant">
          {earnings.settledCount} {earnings.settledCount === 1 ? "payment" : "payments"} paid out
          {change !== null && period && (
            <span
              className={`ml-stack-sm inline-flex items-center gap-1 ${up ? "text-primary" : "text-error"}`}
            >
              <span className="material-symbols-outlined text-base" aria-hidden>
                {up ? "trending_up" : "trending_down"}
              </span>
              {up ? "+" : ""}
              {change}% {period}
            </span>
          )}
        </p>
      </div>
      <div className="tonal-card rounded-xl p-stack-lg">
        <p className="text-label-md uppercase text-on-surface-variant">Pending payouts</p>
        <p className="mt-stack-sm font-mono text-headline-md text-secondary">
          {displayPhp(dec(earnings.pendingPhp))}
        </p>
        <p className="mt-stack-sm inline-flex items-center gap-stack-sm text-body-sm text-on-surface-variant">
          {earnings.pendingCount > 0 && (
            <span className="h-1.5 w-1.5 rounded-full bg-secondary motion-safe:animate-pulse" />
          )}
          {earnings.pendingCount > 0
            ? `${earnings.pendingCount} on the way to your account`
            : "Nothing on the way right now"}
        </p>
      </div>
    </div>
  );
}
