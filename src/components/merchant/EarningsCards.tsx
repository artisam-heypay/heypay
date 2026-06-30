import { dec, displayPhp, displayXlm } from "@/lib/money";
import type { MerchantEarnings } from "@/server/merchant/service";

export function EarningsCards({ earnings }: { earnings: MerchantEarnings }) {
  const mom = earnings.momChangePct;
  const momUp = (mom ?? 0) >= 0;
  return (
    <div className="grid grid-cols-1 gap-stack-lg md:grid-cols-2">
      <div className="tonal-card rounded-xl p-stack-lg">
        <p className="text-label-md uppercase text-on-surface-variant">Total Settled</p>
        <p className="mt-stack-sm text-display-lg text-primary">
          {displayPhp(dec(earnings.totalSettledPhp))}
        </p>
        {mom !== null && (
          <p
            className={`mt-stack-sm inline-flex items-center gap-stack-sm text-body-sm ${momUp ? "text-primary" : "text-error"}`}
          >
            <span className="material-symbols-outlined text-base">
              {momUp ? "trending_up" : "trending_down"}
            </span>
            {momUp ? "+" : ""}
            {mom}% vs last month
          </p>
        )}
      </div>
      <div className="tonal-card rounded-xl p-stack-lg">
        <p className="text-label-md uppercase text-on-surface-variant">Pending XLM Trades</p>
        <p className="mt-stack-sm font-mono text-headline-md text-secondary">
          {displayXlm(dec(earnings.pendingXlm))}
        </p>
        <p className="mt-stack-sm inline-flex items-center gap-stack-sm text-body-sm text-on-surface-variant">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary motion-safe:animate-pulse" />
          Converting to PHP
        </p>
      </div>
    </div>
  );
}
