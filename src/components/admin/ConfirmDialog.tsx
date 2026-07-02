"use client";
import { useEffect, useRef } from "react";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = "primary",
  onConfirm,
  onCancel,
  pending,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "primary" | "error";
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 p-stack-md"
    >
      <div className="w-full max-w-sm rounded-lg bg-surface-container-lowest p-stack-lg shadow-lg">
        <h2 className="font-display text-headline-md text-on-surface">{title}</h2>
        <p className="mt-stack-sm text-body-md text-on-surface-variant">{body}</p>
        <div className="mt-stack-lg flex justify-end gap-stack-sm">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-outline-variant px-stack-lg py-2 text-body-md text-on-surface hover:bg-surface-container-high disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            ref={ref}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`rounded-lg px-stack-lg py-2 text-body-md disabled:opacity-50 ${
              tone === "error" ? "bg-error text-on-error" : "bg-primary text-on-primary"
            }`}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
