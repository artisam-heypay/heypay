import { getOverview } from "@/server/admin/overview";
import { displayXlm, displayPhp } from "@/lib/money";
import { StatCard } from "@/components/admin/StatCard";
import { StatBadge } from "@/components/admin/StatBadge";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const o = await getOverview();
  return (
    <section aria-labelledby="admin-overview-heading">
      <h1
        id="admin-overview-heading"
        className="font-display text-headline-lg-mobile text-on-surface lg:text-headline-lg"
      >
        System Overview
      </h1>

      <div className="mt-stack-lg grid grid-cols-1 gap-stack-lg sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Users"
          value={o.counts.users.toLocaleString()}
          sub={`${o.counts.payers} payers`}
          icon="group"
        />
        <StatCard
          label="Merchants"
          value={o.counts.merchants.toLocaleString()}
          sub={`${o.counts.activeMerchants} active`}
          icon="storefront"
        />
        <StatCard
          label="Payments"
          value={o.counts.payments.toLocaleString()}
          sub={`${o.counts.settledPayments} settled · ${o.counts.failedPayments} failed`}
          icon="payments"
        />
        <StatCard label="Settled Volume (XLM)" value={displayXlm(o.volume.totalXlm)} icon="star" />
        <StatCard
          label="Settled Volume (PHP)"
          value={displayPhp(o.volume.totalPhpSettled)}
          icon="trending_up"
        />
      </div>

      <div className="mt-stack-lg tonal-card rounded-lg p-stack-lg">
        <h2 className="font-display text-headline-md text-on-surface">Recent Failures</h2>
        {o.recentFailures.length === 0 ? (
          <p className="mt-stack-md text-body-md text-on-surface-variant">No failed payments. 🎉</p>
        ) : (
          <table className="mt-stack-md w-full text-left">
            <thead>
              <tr className="bg-surface-container-low">
                <th className="px-stack-md py-3 text-label-md uppercase text-outline">Reference</th>
                <th className="px-stack-md py-3 text-label-md uppercase text-outline">Merchant</th>
                <th className="px-stack-md py-3 text-label-md uppercase text-outline">Amount</th>
                <th className="px-stack-md py-3 text-label-md uppercase text-outline">Reason</th>
                <th className="px-stack-md py-3 text-label-md uppercase text-outline">Status</th>
              </tr>
            </thead>
            <tbody>
              {o.recentFailures.map((f) => (
                <tr key={f.id} className="border-t border-outline-variant">
                  <td className="px-stack-md py-3 font-mono text-mono-data text-on-surface">
                    {f.reference}
                  </td>
                  <td className="px-stack-md py-3 text-body-md text-on-surface">
                    {f.merchantName}
                  </td>
                  <td className="px-stack-md py-3 font-mono text-mono-data text-on-surface">
                    {displayPhp(f.amountPhp)}
                  </td>
                  <td className="px-stack-md py-3 text-body-sm text-on-surface-variant">
                    {f.failureReason ?? "—"}
                  </td>
                  <td className="px-stack-md py-3">
                    <StatBadge tone="error">Failed</StatBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
