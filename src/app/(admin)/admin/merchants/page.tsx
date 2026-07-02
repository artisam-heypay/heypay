import Link from "next/link";
import { listAdminMerchants } from "@/server/admin/merchants";
import { MerchantStatus } from "@/generated/prisma/client";
import { MerchantStatusControl } from "@/components/admin/MerchantStatusControl";

export const dynamic = "force-dynamic";

export default async function AdminMerchantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const status =
    sp.status && sp.status in MerchantStatus ? (sp.status as MerchantStatus) : undefined;
  const page = await listAdminMerchants({ q: sp.q, status, cursor: sp.cursor, limit: 20 });

  return (
    <section aria-labelledby="admin-merchants-heading">
      <h1
        id="admin-merchants-heading"
        className="font-display text-headline-lg-mobile text-on-surface lg:text-headline-lg"
      >
        Merchants
      </h1>

      <form
        className="mt-stack-lg flex flex-wrap gap-stack-sm"
        role="search"
        action="/admin/merchants"
      >
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search business name"
          aria-label="Search merchants"
          className="flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-2 text-body-md focus:ring-4 focus:ring-primary/10"
        />
        <select
          name="status"
          defaultValue={sp.status ?? ""}
          aria-label="Filter by status"
          className="rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-2 text-body-md"
        >
          <option value="">All statuses</option>
          {Object.values(MerchantStatus).map((s) => (
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
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Business</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Owner</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Settlement</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">
                Status / Action
              </th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((m) => (
              <tr key={m.id} className="border-t border-outline-variant">
                <td className="px-stack-md py-3 text-body-md text-on-surface">{m.businessName}</td>
                <td className="px-stack-md py-3 text-body-md text-on-surface-variant">
                  {m.username}
                </td>
                <td className="px-stack-md py-3 font-mono text-mono-data text-on-surface-variant">
                  {m.settlementBankName} ····{m.accountNumberLast4}
                </td>
                <td className="px-stack-md py-3">
                  <MerchantStatusControl id={m.id} status={m.status} />
                </td>
              </tr>
            ))}
            {page.items.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-stack-md py-stack-lg text-center text-body-md text-on-surface-variant"
                >
                  No merchants found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {page.nextCursor ? (
        <div className="mt-stack-lg flex justify-end">
          <Link
            href={`/admin/merchants?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), cursor: page.nextCursor }).toString()}`}
            className="rounded-lg border border-outline-variant px-stack-lg py-2 text-body-md text-primary hover:bg-surface-container-high"
          >
            Next page
          </Link>
        </div>
      ) : null}
    </section>
  );
}
