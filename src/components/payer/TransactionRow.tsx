import { StatusBadge } from "@/components/ui";
import type { PayerPaymentListItem } from "@/server/payer/data";
import { formatDay } from "@/lib/dates";

export function TransactionRow({
  item,
  onOpen,
  expanded,
}: {
  item: PayerPaymentListItem;
  onOpen: () => void;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={expanded ?? false}
      className="flex w-full min-h-11 items-center justify-between gap-stack-md py-stack-md text-left hover:bg-surface-container-high"
    >
      <div className="min-w-0">
        <p className="truncate font-display text-body-md">{item.merchantName}</p>
        <p className="text-body-sm text-on-surface-variant">
          {item.merchantCity ? `${item.merchantCity} · ` : ""}
          {formatDay(item.createdAt)}
        </p>
        <div className="mt-1">
          <StatusBadge status={item.status} />
        </div>
      </div>
      <div className="flex flex-col items-end">
        <span className="font-mono text-mono-data">{item.amountAsset}</span>
        <span className="text-body-sm text-on-surface-variant">≈ {item.amountPhp}</span>
      </div>
    </button>
  );
}
