"use client";
import { useEffect, useState } from "react";
import { Button, Icon, StatusBadge } from "@/components/ui";
import { WALLET_UPDATED_EVENT } from "./HoldingsLive";

type EscrowRefund = { available: boolean; secondsUntilAvailable: number };

/** The refund link's label says who returned the crypto, and how. */
const REFUND_LABELS = {
  timeout: "Timeout refund on Stellar",
  escrow: "Escrow refund on Stellar",
  treasury: "Refund on Stellar",
} as const;

/** About one Stellar ledger: the slack before asking again after the deadline. */
const SECONDS_PER_LEDGER = 5;

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
    stellarTxUrl: string | null;
    refundTxHash: string | null;
    refundTxUrl: string | null;
    refundKind?: "timeout" | "escrow" | "treasury" | null;
    escrowed?: boolean;
    escrowReleaseTxHash?: string | null;
    escrowReleaseTxUrl?: string | null;
    escrowRefund?: EscrowRefund | null;
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
  // Bumped to load the payment again after an escrow refund.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/payments/${paymentId}?escrow=1`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PaymentDetail | null) => setData(d))
      .catch(() => {});
    return () => controller.abort();
  }, [paymentId, version]);

  // Look again once the escrow deadline should have passed, so the refund
  // button appears without reopening the drawer.
  const escrowRefund = data?.payment.escrowRefund;
  useEffect(() => {
    if (!escrowRefund || escrowRefund.available) return;
    const id = setTimeout(
      () => setVersion((v) => v + 1),
      (escrowRefund.secondsUntilAvailable + SECONDS_PER_LEDGER) * 1000,
    );
    return () => clearTimeout(id);
  }, [escrowRefund]);

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
              {data.payment.stellarTxHash && data.payment.stellarTxUrl && (
                <TxLinkRow
                  label={data.payment.escrowed ? "Escrow deposit on Stellar" : "Payment on Stellar"}
                  hash={data.payment.stellarTxHash}
                  href={data.payment.stellarTxUrl}
                />
              )}
              {data.payment.escrowReleaseTxHash && data.payment.escrowReleaseTxUrl && (
                <TxLinkRow
                  label="Escrow release on Stellar"
                  hash={data.payment.escrowReleaseTxHash}
                  href={data.payment.escrowReleaseTxUrl}
                />
              )}
              {data.payment.refundTxHash && data.payment.refundTxUrl && (
                <TxLinkRow
                  label={REFUND_LABELS[data.payment.refundKind ?? "treasury"]}
                  hash={data.payment.refundTxHash}
                  href={data.payment.refundTxUrl}
                />
              )}
            </dl>

            {data.payment.escrowRefund && (
              <EscrowRefundPanel
                paymentId={paymentId}
                asset={data.payment.asset}
                state={data.payment.escrowRefund}
                onRefunded={() => setVersion((v) => v + 1)}
              />
            )}

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

function waitLabel(seconds: number): string {
  return seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}

/**
 * Shown while the payment's crypto is held in the escrow. Once the escrow's
 * deadline has passed the payer can take it back themselves; the refund then
 * appears as "Timeout refund on Stellar" above.
 */
function EscrowRefundPanel({
  paymentId,
  asset,
  state,
  onRefunded,
}: {
  paymentId: string;
  asset: string;
  state: EscrowRefund;
  onRefunded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refund() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/${paymentId}/escrow-refund`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Could not refund from escrow.");
        return;
      }
      window.dispatchEvent(new Event(WALLET_UPDATED_EVENT));
      onRefunded();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-stack-sm rounded-lg bg-surface-container p-stack-md">
      <h3 className="font-display text-body-lg">Held in escrow</h3>
      <p className="text-body-sm text-on-surface-variant">
        {state.available
          ? `This payment has not been settled in time. You can take your ${asset} back now, or keep waiting for it to settle.`
          : `If this payment is not settled, you can take your ${asset} back in about ${waitLabel(state.secondsUntilAvailable)}.`}
      </p>
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
      {state.available && (
        <Button size="md" variant="outline-pill" onClick={refund} loading={busy}>
          {busy ? "Refunding…" : "Refund from escrow"}
        </Button>
      )}
    </div>
  );
}

/** A transaction hash that opens in the public Stellar explorer. */
function TxLinkRow({ label, hash, href }: { label: string; hash: string; href: string }) {
  return (
    <div className="flex items-center justify-between gap-stack-md py-stack-sm">
      <dt className="shrink-0 text-body-md text-on-surface-variant">{label}</dt>
      <dd className="min-w-0">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1 rounded text-primary underline-offset-2 hover:underline focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          <span className="truncate font-mono text-mono-data">
            {hash.slice(0, 8)}…{hash.slice(-8)}
          </span>
          <Icon name="open_in_new" className="shrink-0 text-base" />
          <span className="sr-only">View on Stellar explorer (opens in a new tab)</span>
        </a>
      </dd>
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
