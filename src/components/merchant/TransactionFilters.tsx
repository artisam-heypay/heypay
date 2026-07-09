"use client";
import { useRouter, useSearchParams } from "next/navigation";

const STATUSES = ["", "SETTLED", "PDAX_TRADING", "PAYOUT_SUBMITTED", "FAILED", "REFUNDED"];

export function TransactionFilters({
  status,
  from,
  to,
}: {
  status?: string;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("cursor");
    router.push(`/merchant/transactions?${next.toString()}`);
  }

  return (
    <form className="flex flex-wrap items-end gap-stack-md">
      <label className="flex flex-col gap-stack-sm text-label-md uppercase text-on-surface-variant">
        Status
        <select
          defaultValue={status ?? ""}
          onChange={(e) => update("status", e.target.value)}
          className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md text-body-md text-on-surface"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s || "All"}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-stack-sm text-label-md uppercase text-on-surface-variant">
        From
        <input
          type="date"
          defaultValue={from ?? ""}
          onChange={(e) => update("from", e.target.value)}
          className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md text-body-md"
        />
      </label>
      <label className="flex flex-col gap-stack-sm text-label-md uppercase text-on-surface-variant">
        To
        <input
          type="date"
          defaultValue={to ?? ""}
          onChange={(e) => update("to", e.target.value)}
          className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md text-body-md"
        />
      </label>
      <a
        href={`/api/merchant/transactions/export?${params.toString()}`}
        className="inline-flex min-h-11 items-center gap-stack-sm rounded-lg bg-primary px-stack-md py-stack-sm text-body-md font-medium text-on-primary"
      >
        <span className="material-symbols-outlined">download</span>Export CSV
      </a>
    </form>
  );
}
