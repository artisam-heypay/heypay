"use client";
import { useEffect, useState } from "react";
import { Icon, StatusBadge } from "@/components/ui";
import type { PaymentStatus } from "@/generated/prisma";

type Detail = {
  payment: {
    reference: string;
    status: PaymentStatus;
    amountPhp: string;
    amountXlm: string;
    quotedRate: string;
    merchantName: string;
    stellarTxHash: string | null;
  };
  events: { fromStatus: PaymentStatus | null; toStatus: PaymentStatus; createdAt: string }[];
};

export function TransactionDrawer({
  paymentId,
  onClose,
}: {
  paymentId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/payments/${paymentId}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("Could not load payment.");
        setDetail((await r.json()) as Detail);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      ctrl.abort();
      window.removeEventListener("keydown", onKey);
    };
  }, [paymentId, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Payment details"
        className="h-full w-full max-w-md overflow-y-auto bg-surface-container-lowest p-stack-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-headline-md font-display">Payment</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-container-high focus:outline-none focus:ring-4 focus:ring-primary/10"
          >
            <Icon name="close" />
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-stack-md text-error">
            {error}
          </p>
        ) : !detail ? (
          <p className="mt-stack-md text-on-surface-variant">Loading…</p>
        ) : (
          <div className="mt-stack-md flex flex-col gap-stack-md">
            <p className="text-mono-data text-body-sm">{detail.payment.reference}</p>
            <p className="font-display text-primary">{detail.payment.merchantName}</p>
            <dl className="divide-y divide-outline-variant">
              <div className="flex justify-between py-stack-sm">
                <dt className="text-on-surface-variant">Amount</dt>
                <dd className="text-mono-data">₱{detail.payment.amountPhp}</dd>
              </div>
              <div className="flex justify-between py-stack-sm">
                <dt className="text-on-surface-variant">XLM</dt>
                <dd className="text-mono-data">{detail.payment.amountXlm}</dd>
              </div>
              <div className="flex justify-between py-stack-sm">
                <dt className="text-on-surface-variant">Rate</dt>
                <dd className="text-mono-data">{detail.payment.quotedRate}</dd>
              </div>
              {detail.payment.stellarTxHash ? (
                <div className="flex justify-between gap-stack-md py-stack-sm">
                  <dt className="text-on-surface-variant">Stellar tx</dt>
                  <dd className="truncate text-mono-data text-body-sm">
                    {detail.payment.stellarTxHash}
                  </dd>
                </div>
              ) : null}
            </dl>
            <div>
              <h3 className="text-label-md uppercase text-on-surface-variant">Timeline</h3>
              <ul className="mt-stack-sm flex flex-col gap-stack-sm">
                {detail.events.map((e, i) => (
                  <li key={i} className="flex items-center justify-between gap-stack-md">
                    <StatusBadge status={e.toStatus} />
                    <span className="text-body-sm text-on-surface-variant">
                      {new Date(e.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
