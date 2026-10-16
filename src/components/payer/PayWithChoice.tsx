"use client";
import { clsx } from "clsx";
import { Icon } from "@/components/ui";
import { dec, displayAsset, displayPhp, type Decimal } from "@/lib/money";

/**
 * An asset the wallet can pay with: about how much of it the payment takes, and
 * how much of it the wallet has.
 */
export type PayChoice = { asset: string; amountAsset: string; available: string };

const twoDecimals = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const smallAmount = new Intl.NumberFormat("en-PH", { maximumSignificantDigits: 3 });

/** An amount to read at a glance; the confirm screen shows it to the last digit. */
function glance(value: Decimal): string {
  const n = value.toNumber();
  // Two decimals read alike side by side; only a tiny amount needs more digits.
  return n >= 0.01 || n === 0 ? twoDecimals.format(n) : smallAmount.format(n);
}

/**
 * The wallet holds enough of more than one asset for this payment, so the payer
 * picks one before any price is locked. Each option says what the payment costs
 * in it and how much of the payer's balance that is; the confirm screen then
 * locks the exact price.
 */
export function PayWithChoice({
  amountPhp,
  merchantName,
  options,
  pending = null,
  backLabel,
  onPick,
  onBack,
}: {
  amountPhp: string;
  merchantName?: string | null;
  options: PayChoice[];
  /** The asset picked, while its price is being locked. */
  pending?: string | null;
  backLabel: string;
  onPick: (asset: string) => void;
  onBack: () => void;
}) {
  const php = dec(amountPhp);
  return (
    <section aria-labelledby="pay-with-heading" className="flex flex-col gap-stack-lg">
      <div className="flex flex-col gap-1">
        <h2 id="pay-with-heading" className="font-display text-headline-md text-balance">
          Pay {displayPhp(php)}
          {merchantName ? ` to ${merchantName}` : ""}
        </h2>
        <p className="text-body-md text-on-surface-variant">
          You have enough of both. Pick a coin, and the next screen locks its exact price.
        </p>
      </div>

      <div role="group" aria-label="Pay with" className="grid gap-stack-md sm:grid-cols-2">
        {options.map((o) => {
          const cost = dec(o.amountAsset);
          const held = dec(o.available);
          // What one coin is worth now, from this payment's own price.
          const heldPhp = cost.isZero() ? null : held.times(php).div(cost);
          const share = held.isZero() ? 100 : Math.min(100, cost.div(held).times(100).toNumber());
          const shareLabel = share < 1 ? "less than 1%" : `${Math.round(share)}%`;
          const picked = pending === o.asset;
          return (
            <button
              key={o.asset}
              type="button"
              aria-label={`${o.asset}, about ${displayAsset(cost, o.asset)}`}
              aria-busy={picked || undefined}
              disabled={pending !== null}
              onClick={() => onPick(o.asset)}
              className={clsx(
                "group flex min-h-11 flex-col gap-stack-md rounded-xl border-2 bg-surface-container-lowest p-stack-md text-left",
                "transition-[border-color,box-shadow,opacity] duration-200 ease-out motion-reduce:transition-none",
                "hover:border-primary hover:shadow-lg hover:shadow-primary/10",
                "focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/20",
                "disabled:cursor-default disabled:hover:shadow-none",
                picked ? "border-primary shadow-lg shadow-primary/10" : "border-outline-variant",
                pending !== null && !picked && "opacity-50 disabled:hover:border-outline-variant",
              )}
            >
              <span className="flex items-center justify-between gap-stack-sm">
                <span className="flex items-center gap-stack-sm">
                  <span
                    aria-hidden
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-display text-body-md font-bold text-primary"
                  >
                    {o.asset.slice(0, 1)}
                  </span>
                  <span className="font-display text-body-lg font-bold">{o.asset}</span>
                </span>
                {picked ? (
                  <span
                    aria-hidden
                    className="h-5 w-5 animate-spin rounded-full border-2 border-surface-container-high border-t-primary motion-reduce:animate-none"
                  />
                ) : (
                  <Icon
                    name="arrow_forward"
                    className="text-on-surface-variant transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-primary group-disabled:translate-x-0 motion-reduce:transition-none"
                  />
                )}
              </span>

              <span className="flex flex-col">
                <span className="font-mono text-headline-md font-bold tabular-nums text-on-surface">
                  {glance(cost)}{" "}
                  <span className="font-body text-body-md font-normal text-on-surface-variant">
                    {o.asset}
                  </span>
                </span>
                <span className="text-body-sm text-on-surface-variant">
                  {picked ? "Locking the price…" : "About what this payment costs"}
                </span>
              </span>

              <span className="flex flex-col gap-stack-sm border-t border-outline-variant pt-stack-sm">
                <span className="text-body-sm text-on-surface-variant">
                  You have{" "}
                  <span className="font-mono tabular-nums text-on-surface">
                    {glance(held)} {o.asset}
                  </span>
                  {heldPhp && <> ≈ {displayPhp(heldPhp)}</>}
                </span>
                <span
                  aria-hidden
                  className="h-1.5 overflow-hidden rounded-full bg-surface-container-high"
                >
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(share, 2)}%` }}
                  />
                </span>
                <span className="text-body-sm text-on-surface-variant">
                  Uses {shareLabel} of your {o.asset}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onBack}
        disabled={pending !== null}
        className="inline-flex min-h-11 items-center gap-1 self-start rounded-full px-stack-sm font-display text-body-md font-bold text-primary hover:bg-primary/5 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 disabled:opacity-50"
      >
        <Icon name="arrow_back" />
        {backLabel}
      </button>
    </section>
  );
}
