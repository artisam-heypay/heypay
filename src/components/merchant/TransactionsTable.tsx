import { StatusBadge } from "@/components/ui/StatusBadge";
import type { MerchantTxItem } from "@/server/merchant/service";

export function TransactionsTable({ items }: { items: MerchantTxItem[] }) {
  if (items.length === 0) {
    return (
      <div className="tonal-card rounded-xl p-margin-desktop text-center text-body-md text-on-surface-variant">
        No transactions yet.
      </div>
    );
  }
  return (
    <div className="tonal-card overflow-hidden rounded-xl">
      <table className="w-full border-collapse">
        <thead className="bg-surface-container-low">
          <tr className="text-left text-label-md uppercase text-outline">
            <th className="px-stack-md py-stack-md">Customer</th>
            <th className="px-stack-md py-stack-md">Received</th>
            <th className="hidden px-stack-md py-stack-md md:table-cell">Settlement</th>
            <th className="px-stack-md py-stack-md">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr
              key={t.id}
              className={`relative border-t border-outline-variant ${
                t.stellarTxUrl
                  ? "cursor-pointer transition-colors hover:bg-surface-container-low focus-within:bg-surface-container-low"
                  : ""
              }`}
            >
              <td className="px-stack-md py-stack-md">
                <p className="text-body-md text-on-surface">{t.customer}</p>
                <p className="font-mono text-mono-data text-outline">{t.reference}</p>
                {t.stellarTxUrl && (
                  // The link's ::after covers the whole row, so any click on the row
                  // opens the payment in the public Stellar explorer.
                  <a
                    href={t.stellarTxUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 rounded text-body-sm text-primary after:absolute after:inset-0 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/20"
                  >
                    View on Stellar
                    <span className="material-symbols-outlined text-base" aria-hidden>
                      open_in_new
                    </span>
                    <span className="sr-only">
                      {` — payment ${t.reference} in the Stellar explorer (opens in a new tab)`}
                    </span>
                  </a>
                )}
              </td>
              <td className="px-stack-md py-stack-md">
                <p className="font-mono text-mono-data font-semibold text-on-surface">
                  {t.amountAsset} {t.asset}
                </p>
                <p className="font-mono text-mono-data text-outline">≈ ₱{t.amountPhp}</p>
              </td>
              <td className="hidden px-stack-md py-stack-md font-mono text-mono-data text-on-surface md:table-cell">
                {t.netSettledPhp ? `₱${t.netSettledPhp}` : "—"}
              </td>
              <td className="px-stack-md py-stack-md">
                <StatusBadge status={t.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
