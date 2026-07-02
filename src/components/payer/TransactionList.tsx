"use client";
import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui";
import { TransactionRow } from "./TransactionRow";
import { TransactionDrawer } from "./TransactionDrawer";
import type { PayerPaymentListItem } from "@/server/payer/data";

type LoadMore = (cursor: string) => Promise<{ items: PayerPaymentListItem[]; nextCursor?: string }>;

export function TransactionList({
  initial,
  initialCursor,
  loadMore,
}: {
  initial: PayerPaymentListItem[];
  initialCursor?: string;
  loadMore: LoadMore;
}) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState<string | undefined>(initialCursor);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

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
    return (
      <div className="flex flex-col items-center gap-stack-md py-stack-lg text-center">
        <Icon name="history" className="text-4xl text-on-surface-variant" />
        <p className="text-body-md text-on-surface-variant">No transactions yet</p>
        <Link
          href="/payer/scan"
          className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-primary px-stack-lg py-3 font-display font-bold text-on-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          Scan to Pay
          <Icon name="qr_code_scanner" />
        </Link>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-outline-variant">
        {items.map((item) => (
          <li key={item.id}>
            <TransactionRow
              item={item}
              expanded={openId === item.id}
              onOpen={() => setOpenId(item.id)}
            />
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

      {openId && <TransactionDrawer paymentId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
