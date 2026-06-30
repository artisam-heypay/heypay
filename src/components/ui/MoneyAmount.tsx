import { clsx } from "clsx";
import { type Decimal, displayPhp, displayXlm } from "@/lib/money";

export function MoneyAmount({
  xlm,
  php,
  size = "md",
  phpPrefix = "≈",
}: {
  xlm: Decimal;
  php: Decimal;
  size?: "display" | "md" | "row";
  phpPrefix?: string;
}) {
  const xlmCls =
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
      <span className={clsx("font-mono", xlmCls)}>{displayXlm(xlm)}</span>
      <span className={phpCls}>
        {phpPrefix} {displayPhp(php)}
      </span>
    </div>
  );
}
