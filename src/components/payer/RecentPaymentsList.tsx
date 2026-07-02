import Link from "next/link";
import { Card, Icon, MoneyAmount, StatusBadge } from "@/components/ui";
import type { RecentPayment } from "@/server/payer/data";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function RecentPaymentsList({ payments }: { payments: RecentPayment[] }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-headline-md">Recent Payments</h2>
        <Link
          href="/payer/transactions"
          className="rounded-lg text-body-sm text-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          View all
        </Link>
      </div>

      {payments.length === 0 ? (
        <div className="flex flex-col items-center gap-stack-md py-stack-lg text-center">
          <Icon name="history" className="text-4xl text-on-surface-variant" />
          <p className="text-body-md text-on-surface-variant">No payments yet</p>
          <Link
            href="/payer/scan"
            className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-primary px-stack-lg py-3 font-display font-bold text-on-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
          >
            Scan to Pay
            <Icon name="qr_code_scanner" />
          </Link>
        </div>
      ) : (
        <ul className="mt-stack-md divide-y divide-outline-variant">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-stack-md py-stack-md">
              <div className="min-w-0">
                <p className="truncate font-display text-body-md">{p.merchantName}</p>
                <p className="text-body-sm text-on-surface-variant">
                  {p.merchantCity ? `${p.merchantCity} · ` : ""}
                  {formatDate(p.createdAt)}
                </p>
                <div className="mt-1">
                  <StatusBadge status={p.status} />
                </div>
              </div>
              <MoneyAmount xlm={p.amountXlm} php={p.amountPhp} size="row" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
