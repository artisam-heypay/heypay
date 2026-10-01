import Link from "next/link";
import { listAdminPayments } from "@/server/admin/payments";
import { PaymentStatus } from "@/generated/prisma/client";
import { PaymentRow } from "@/components/admin/PaymentRow";

export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status && sp.status in PaymentStatus ? (sp.status as PaymentStatus) : undefined;
  const page = await listAdminPayments({ q: sp.q, status, cursor: sp.cursor, limit: 20 });

  return (
    <section aria-labelledby="admin-payments-heading">
      <h1
        id="admin-payments-heading"
        className="font-display text-headline-lg-mobile text-on-surface lg:text-headline-lg"
      >
        Payments
      </h1>

      <form
        className="mt-stack-lg flex flex-wrap gap-stack-sm"
        role="search"
        action="/admin/payments"
      >
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search reference / payer / merchant"
          aria-label="Search payments"
          className="flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-2 text-body-md focus:ring-4 focus:ring-primary/10"
        />
        <select
          name="status"
          defaultValue={sp.status ?? ""}
          aria-label="Filter by status"
          className="rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-2 text-body-md"
        >
          <option value="">All statuses</option>
          {Object.values(PaymentStatus).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-primary px-stack-lg py-2 text-on-primary">
          Filter
        </button>
      </form>

      <div className="mt-stack-lg overflow-x-auto tonal-card rounded-lg">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Reference</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">
                Payer → Merchant
              </th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Amount</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Status</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Actions</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((p) => (
              <PaymentRow
                key={p.id}
                row={{
                  id: p.id,
                  reference: p.reference,
                  status: p.status,
                  payerUsername: p.payerUsername,
                  merchantName: p.merchantName,
                  amountPhp: p.amountPhp.toFixed(2),
                  asset: p.asset,
                  amountAsset: p.amountAsset.toFixed(7),
                  failureReason: p.failureReason,
                  createdAt: p.createdAt.toISOString(),
                }}
              />
            ))}
            {page.items.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-stack-md py-stack-lg text-center text-body-md text-on-surface-variant"
                >
                  No payments found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {page.nextCursor ? (
        <div className="mt-stack-lg flex justify-end">
          <Link
            href={`/admin/payments?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), cursor: page.nextCursor }).toString()}`}
            className="rounded-lg border border-outline-variant px-stack-lg py-2 text-body-md text-primary hover:bg-surface-container-high"
          >
            Next page
          </Link>
        </div>
      ) : null}
    </section>
  );
}
