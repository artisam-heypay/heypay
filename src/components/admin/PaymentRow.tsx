"use client";
import { useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PaymentStatus } from "@/generated/prisma/client";
import { StatBadge } from "@/components/admin/StatBadge";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";

function Portal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export type PaymentRowData = {
  id: string;
  reference: string;
  status: PaymentStatus;
  payerUsername: string;
  merchantName: string;
  amountPhp: string;
  amountXlm: string;
  failureReason: string | null;
  createdAt: string;
};
type EventItem = {
  id: string;
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus;
  detail: unknown;
  createdAt: string;
};

function tone(status: PaymentStatus): "settled" | "pending" | "error" | "neutral" {
  if (status === "SETTLED") return "settled";
  if (status === "FAILED" || status === "REFUND_PENDING" || status === "REFUNDED") return "error";
  if (status === "CREATED") return "neutral";
  return "pending";
}

export function PaymentRow({ row }: { row: PaymentRowData }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [dialog, setDialog] = useState<null | "retry" | "refund">(null);
  const [status, setStatus] = useState<PaymentStatus>(row.status);
  const [pending, start] = useTransition();

  async function loadTimeline() {
    if (!open && !events) {
      const res = await fetch(`/api/admin/payments/${row.id}`, { credentials: "same-origin" });
      if (res.ok) setEvents((await res.json()).events as EventItem[]);
    }
    setOpen((v) => !v);
  }

  function act(kind: "retry" | "refund") {
    start(async () => {
      const res = await fetch(`/api/admin/payments/${row.id}/${kind}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (res.ok) setStatus((await res.json()).status as PaymentStatus);
      setDialog(null);
    });
  }

  return (
    <>
      <tr className="border-t border-outline-variant align-top" data-payment-id={row.id}>
        <td className="px-stack-md py-3 font-mono text-mono-data text-on-surface">
          {row.reference}
        </td>
        <td className="px-stack-md py-3 text-body-md text-on-surface">
          {row.payerUsername} → {row.merchantName}
        </td>
        <td className="px-stack-md py-3">
          <div className="font-mono text-mono-data font-semibold text-on-surface">
            {row.amountXlm} XLM
          </div>
          <div className="font-mono text-mono-data text-outline">₱{row.amountPhp}</div>
        </td>
        <td className="px-stack-md py-3">
          <StatBadge tone={tone(status)}>{status.replace(/_/g, " ")}</StatBadge>
        </td>
        <td className="px-stack-md py-3">
          <div className="flex flex-wrap gap-stack-sm">
            <button
              type="button"
              onClick={loadTimeline}
              aria-expanded={open}
              aria-label={`View timeline for ${row.reference}`}
              className="rounded-lg border border-outline-variant px-stack-md py-2 text-label-md uppercase text-on-surface hover:bg-surface-container-high"
            >
              {open ? "Hide" : "View timeline"}
            </button>
            <button
              type="button"
              onClick={() => setDialog("retry")}
              aria-label="Retry payment"
              className="rounded-lg bg-primary/10 px-stack-md py-2 text-label-md uppercase text-primary hover:bg-primary/20"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => setDialog("refund")}
              aria-label="Refund payment"
              className="rounded-lg bg-secondary/10 px-stack-md py-2 text-label-md uppercase text-secondary hover:bg-secondary/20"
            >
              Refund
            </button>
          </div>
        </td>
      </tr>
      {open && events ? (
        <tr className="border-t border-outline-variant bg-surface-container-low">
          <td colSpan={5} className="px-stack-md py-stack-md">
            <ol className="flex flex-col gap-stack-sm">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-stack-md">
                  <span className="material-symbols-outlined text-primary" aria-hidden="true">
                    check_circle
                  </span>
                  <span className="font-mono text-mono-data text-on-surface">
                    {e.fromStatus ? `${e.fromStatus} → ` : ""}
                    {e.toStatus}
                  </span>
                  <span className="font-mono text-mono-data text-outline">
                    {new Date(e.createdAt).toISOString().replace("T", " ").slice(0, 19)}
                  </span>
                  {e.detail ? (
                    <span className="text-body-sm text-on-surface-variant">
                      {JSON.stringify(e.detail)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </td>
        </tr>
      ) : null}

      <Portal>
        <ConfirmDialog
          open={dialog === "retry"}
          tone="primary"
          pending={pending}
          title="Retry settlement"
          confirmLabel="Confirm retry"
          body={`Re-enqueue settlement for ${row.reference} from its current status?`}
          onCancel={() => setDialog(null)}
          onConfirm={() => act("retry")}
        />
      </Portal>
      <Portal>
        <ConfirmDialog
          open={dialog === "refund"}
          tone="error"
          pending={pending}
          title="Refund payment"
          confirmLabel="Confirm refund"
          body={`Return XLM to the payer for ${row.reference}? This sets the payment to REFUND_PENDING.`}
          onCancel={() => setDialog(null)}
          onConfirm={() => act("refund")}
        />
      </Portal>
    </>
  );
}
