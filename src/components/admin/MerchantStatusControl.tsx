"use client";
import { useState, useTransition } from "react";
import type { MerchantStatus } from "@/generated/prisma/client";
import { StatBadge } from "@/components/admin/StatBadge";

const TONE: Record<MerchantStatus, "settled" | "pending" | "error" | "neutral"> = {
  ACTIVE: "settled",
  PENDING_REVIEW: "pending",
  SUSPENDED: "error",
  DRAFT: "neutral",
};
const LABEL: Record<MerchantStatus, string> = {
  ACTIVE: "Active",
  PENDING_REVIEW: "Pending Review",
  SUSPENDED: "Suspended",
  DRAFT: "Draft",
};

export function MerchantStatusControl({ id, status }: { id: string; status: MerchantStatus }) {
  const [current, setCurrent] = useState<MerchantStatus>(status);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: MerchantStatus) {
    setError(null);
    start(async () => {
      const res = await fetch(`/api/admin/merchants/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setError("Update failed");
        return;
      }
      const body = await res.json();
      setCurrent(body.status as MerchantStatus);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-stack-sm">
      <StatBadge tone={TONE[current]}>{LABEL[current]}</StatBadge>
      {current !== "ACTIVE" ? (
        <button
          type="button"
          onClick={() => change("ACTIVE")}
          disabled={pending}
          aria-label="Activate merchant"
          className="rounded-lg bg-primary/10 px-stack-md py-2 text-label-md uppercase text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          Activate
        </button>
      ) : null}
      {current !== "SUSPENDED" ? (
        <button
          type="button"
          onClick={() => change("SUSPENDED")}
          disabled={pending}
          aria-label="Suspend merchant"
          className="rounded-lg bg-error/10 px-stack-md py-2 text-label-md uppercase text-error hover:bg-error/20 disabled:opacity-50"
        >
          Suspend
        </button>
      ) : null}
      {error ? (
        <span role="alert" className="text-body-sm text-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
