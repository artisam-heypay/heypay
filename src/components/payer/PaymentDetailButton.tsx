"use client";
import { useState } from "react";
import { TransactionDrawer } from "./TransactionDrawer";

/**
 * Makes a server-rendered payment row open its detail drawer (with the Stellar
 * explorer link). The row's content stays server-rendered and is passed in as
 * children, so no server-only values cross into this client component.
 */
export function PaymentDetailButton({
  paymentId,
  label,
  className,
  children,
}: {
  paymentId: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        className={className}
      >
        {children}
      </button>
      {open && <TransactionDrawer paymentId={paymentId} onClose={() => setOpen(false)} />}
    </>
  );
}
