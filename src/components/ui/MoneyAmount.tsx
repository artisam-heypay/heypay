import { clsx } from "clsx";
import { type Decimal, displayAsset, displayPhp } from "@/lib/money";

export function MoneyAmount({
  xlm,
  asset = "XLM",
  php,
  size = "md",
  phpPrefix = "≈",
}: {
  /** Crypto amount, denominated in `asset`. */
  xlm: Decimal;
  asset?: string;
  /** Null when no rate is available — better to show nothing than a false ₱0.00. */
  php: Decimal | null;
  size?: "display" | "md" | "row";
  phpPrefix?: string;
}) {
  const cryptoCls =
    size === "display"
      ? "text-display-lg text-primary"
      : size === "row"
        ? "text-mono-data"
        : "text-headline-md text-primary font-mono";
  const phpCls =
    size === "display"
      ? "text-headline-md text-on-surface-variant"
      : "text-body-sm text-on-surface-variant";
  return (
    <div className={clsx(size === "row" ? "flex flex-col items-end" : "flex flex-col")}>
      <span className={clsx("font-mono", cryptoCls)}>{displayAsset(xlm, asset)}</span>
      {php !== null && (
        <span className={phpCls}>
          {phpPrefix} {displayPhp(php)}
        </span>
      )}
    </div>
  );
}
