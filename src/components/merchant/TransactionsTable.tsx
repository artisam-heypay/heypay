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
            <tr key={t.id} className="border-t border-outline-variant">
              <td className="px-stack-md py-stack-md">
                <p className="text-body-md text-on-surface">{t.customer}</p>
                <p className="font-mono text-mono-data text-outline">{t.reference}</p>
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
