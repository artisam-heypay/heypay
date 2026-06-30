import { StatusBadge } from "@/components/ui";
import type { PayerPaymentListItem } from "@/server/payer/data";

export function TransactionRow({
  item,
  onOpen,
}: {
  item: PayerPaymentListItem;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      aria-haspopup="dialog"
      className="flex min-h-11 w-full items-center justify-between gap-stack-md py-stack-md text-left hover:bg-surface-container-high focus:outline-none focus:ring-4 focus:ring-primary/10"
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-display">{item.merchantName}</span>
        <span className="text-body-sm text-on-surface-variant">
          {item.merchantCity ? `${item.merchantCity} · ` : ""}
          {new Date(item.createdAt).toLocaleDateString()}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-stack-md">
        <StatusBadge status={item.status} />
        <div className="flex flex-col items-end">
          <span className="font-mono text-mono-data">{item.amountXlm}</span>
          <span className="text-body-sm text-on-surface-variant">{item.amountPhp}</span>
        </div>
      </div>
    </button>
  );
}
