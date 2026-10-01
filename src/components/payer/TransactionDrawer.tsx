"use client";
import { useEffect, useState } from "react";
import { Icon, StatusBadge } from "@/components/ui";

type PaymentDetail = {
  payment: {
    reference: string;
    status: string;
    amountPhp: string;
    quotedRate: string;
    asset: string;
    amountAsset: string;
    networkFeeXlm: string;
    merchantName: string;
    stellarTxHash: string | null;
    createdAt: string;
  };
  events: { fromStatus: string | null; toStatus: string; createdAt: string }[];
};

export function TransactionDrawer({
  paymentId,
  onClose,
}: {
  paymentId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<PaymentDetail | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/payments/${paymentId}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PaymentDetail | null) => setData(d))
      .catch(() => {});
    return () => controller.abort();
  }, [paymentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Payment detail"
        className="relative h-full w-full max-w-md overflow-y-auto bg-surface-container-lowest p-stack-lg shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-headline-md">Payment detail</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-surface-container-high focus:outline-none focus:ring-4 focus:ring-primary/10"
          >
            <Icon name="close" />
          </button>
        </div>

        {!data ? (
          <p className="mt-stack-lg text-body-md text-on-surface-variant">Loading…</p>
        ) : (
          <div className="mt-stack-lg flex flex-col gap-stack-lg">
            <div>
              <p className="font-mono text-mono-data text-on-surface-variant">
                {data.payment.reference}
              </p>
              <p className="font-display text-headline-md">{data.payment.merchantName}</p>
              <div className="mt-stack-sm">
                <StatusBadge status={data.payment.status as never} />
              </div>
            </div>

            <dl className="divide-y divide-outline-variant">
              <Row label="Amount (PHP)" value={`₱${data.payment.amountPhp}`} />
              <Row label="Rate" value={`1 ${data.payment.asset} = ₱${data.payment.quotedRate}`} />
              <Row
                label={`${data.payment.asset} debited`}
                value={`${data.payment.amountAsset} ${data.payment.asset}`}
              />
              <Row label="Network fee" value={`${data.payment.networkFeeXlm} XLM`} />
              {data.payment.stellarTxHash && (
                <Row label="Stellar tx" value={data.payment.stellarTxHash} mono />
              )}
            </dl>

            <div>
              <h3 className="font-display text-body-lg">Timeline</h3>
              <ol className="mt-stack-sm flex flex-col gap-stack-sm">
                {data.events.map((e, i) => (
                  <li key={i} className="flex items-center justify-between gap-stack-md">
                    <StatusBadge status={e.toStatus as never} label={e.toStatus} />
                    <span className="text-body-sm text-on-surface-variant">
                      {new Date(e.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-stack-md py-stack-sm">
      <dt className="text-body-md text-on-surface-variant">{label}</dt>
      <dd className={mono ? "truncate font-mono text-mono-data" : "font-mono text-mono-data"}>
        {value}
      </dd>
    </div>
  );
}
