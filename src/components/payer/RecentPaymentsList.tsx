import Link from "next/link";
import { Button, Card, Icon, MoneyAmount, StatusBadge } from "@/components/ui";
import type { Decimal } from "@/lib/money";
import type { PaymentStatus } from "@/generated/prisma";

export type RecentPaymentItem = {
  id: string;
  reference: string;
  merchantName: string;
  amountXlm: Decimal;
  amountPhp: Decimal;
  status: PaymentStatus;
  createdAt: Date | string;
};

export function RecentPaymentsList({ items }: { items: RecentPaymentItem[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-stack-md py-stack-lg text-center">
          <Icon name="history" className="text-4xl text-on-surface-variant" />
          <p className="text-on-surface-variant">No payments yet</p>
          <Link href="/payer/scan">
            <Button variant="primary-pill" trailingIcon="qr_code_scanner">
              Scan to Pay
            </Button>
          </Link>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="text-headline-md font-display">Recent Payments</h2>
        <Link href="/payer/transactions" className="text-body-sm text-primary">
          View all
        </Link>
      </div>
      <ul className="mt-stack-md divide-y divide-outline-variant">
        {items.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-stack-md py-stack-md">
            <div className="flex flex-col">
              <span className="font-display">{p.merchantName}</span>
              <span className="text-body-sm text-on-surface-variant">
                {new Date(p.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div className="flex items-center gap-stack-md">
              <StatusBadge status={p.status} />
              <MoneyAmount size="row" xlm={p.amountXlm} php={p.amountPhp} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
