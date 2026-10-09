"use client";
import { useState } from "react";
import type { PayerSwapListItem } from "@/server/payer/swap";

type LoadMore = (cursor: string) => Promise<{ items: PayerSwapListItem[]; nextCursor?: string }>;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SwapList({
  initial,
  initialCursor,
  loadMore,
}: {
  initial: PayerSwapListItem[];
  initialCursor?: string;
  loadMore: LoadMore;
}) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState<string | undefined>(initialCursor);
  const [busy, setBusy] = useState(false);

  async function more() {
    if (!cursor) return;
    setBusy(true);
    try {
      const res = await loadMore(cursor);
      setItems((prev) => [...prev, ...res.items]);
      setCursor(res.nextCursor);
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return <p className="text-body-md text-on-surface-variant">No swaps yet.</p>;
  }

  return (
    <>
      <ul className="divide-y divide-outline-variant">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-x-stack-md gap-y-1 py-stack-md"
          >
            <div className="min-w-0">
              <p className="font-mono text-mono-data">
                {item.sent}
                {item.received && ` → ${item.received}`}
              </p>
              <p className="text-body-sm text-on-surface-variant">{formatDate(item.createdAt)}</p>
            </div>
            <a
              href={item.txUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center rounded text-body-sm text-primary underline focus:outline-none focus:ring-4 focus:ring-primary/10"
            >
              View transaction
            </a>
          </li>
        ))}
      </ul>

      {cursor && (
        <button
          type="button"
          onClick={more}
          aria-busy={busy || undefined}
          className="mt-stack-md inline-flex min-h-11 items-center justify-center rounded-full border-2 border-primary px-stack-lg py-3 font-display font-bold text-primary disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-primary/10"
          disabled={busy}
        >
          {busy ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}
