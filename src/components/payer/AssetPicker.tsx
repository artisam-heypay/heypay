"use client";
import { clsx } from "clsx";

export type AssetOption = {
  asset: string;
  /** Available balance, formatted for display (e.g. "12.5000000 USDT"). */
  balance?: string;
  /** False for an issued asset the wallet has no trustline to yet. */
  canReceive?: boolean;
  disabled?: boolean;
};

/**
 * Radio group for choosing the funding asset. Rendered only when more than one
 * asset is enabled — with a single asset there is nothing to pick.
 */
export function AssetPicker({
  options,
  value,
  onChange,
  label = "Pay with",
  busy,
}: {
  options: AssetOption[];
  value: string;
  onChange: (asset: string) => void;
  label?: string;
  busy?: boolean;
}) {
  if (options.length < 2) return null;

  return (
    <fieldset disabled={busy}>
      <legend className="text-label-md uppercase text-on-surface-variant">{label}</legend>
      <div role="radiogroup" aria-label={label} className="mt-stack-sm flex flex-wrap gap-stack-sm">
        {options.map((opt) => {
          const selected = opt.asset === value;
          return (
            <button
              key={opt.asset}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={opt.disabled || busy}
              onClick={() => onChange(opt.asset)}
              className={clsx(
                "flex min-h-11 flex-col items-start rounded-lg border-2 px-stack-md py-2 text-left",
                "focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:opacity-50",
                selected
                  ? "border-primary bg-primary/5"
                  : "border-outline-variant hover:border-primary/50",
              )}
            >
              <span className="font-display text-body-md font-bold">{opt.asset}</span>
              {opt.balance && (
                <span className="font-mono text-mono-data text-on-surface-variant">
                  {opt.balance}
                </span>
              )}
              {opt.canReceive === false && (
                <span className="text-body-sm text-on-surface-variant">Trustline needed</span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
