"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Card, Icon } from "@/components/ui";
import type { PayerPaymentListItem } from "@/server/payer/data";
import { TransactionRow } from "./TransactionRow";
import { TransactionDrawer } from "./TransactionDrawer";

type LoadMore = (cursor: string) => Promise<{ items: PayerPaymentListItem[]; nextCursor?: string }>;

export function TransactionList({
  initial,
  nextCursor: initialCursor,
  loadMore,
}: {
  initial: PayerPaymentListItem[];
  nextCursor?: string;
  loadMore: LoadMore;
}) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const more = async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const res = await loadMore(cursor);
      setItems((prev) => [...prev, ...res.items]);
      setCursor(res.nextCursor);
    } finally {
      setLoading(false);
    }
  };

  if (items.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-stack-md py-stack-lg text-center">
          <Icon name="history" className="text-4xl text-on-surface-variant" />
          <p className="text-on-surface-variant">No transactions yet</p>
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
    <>
      <Card>
        <ul className="divide-y divide-outline-variant">
          {items.map((it) => (
            <li key={it.id}>
              <TransactionRow item={it} onOpen={setOpenId} />
            </li>
          ))}
        </ul>
        {cursor ? (
          <div className="mt-stack-md flex justify-center">
            <Button variant="outline-pill" loading={loading} onClick={() => void more()}>
              Load more
            </Button>
          </div>
        ) : null}
      </Card>
      {openId ? <TransactionDrawer paymentId={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}
