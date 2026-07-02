"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { dec, displayXlm } from "@/lib/money";
import { Icon } from "@/components/ui";

export function PendingDepositWatcher({ initialBalance }: { initialBalance: string }) {
  const [delta, setDelta] = useState<string | null>(null);
  const baseRef = useRef(dec(initialBalance));

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/wallet/sync", {
          method: "POST",
          headers: { origin: window.location.origin },
          signal: controller.signal,
        });
        if (!res.ok) return;
        const { balanceXlm } = (await res.json()) as { balanceXlm: string };
        const diff = dec(balanceXlm).minus(baseRef.current);
        if (diff.greaterThan(0)) {
          setDelta(displayXlm(diff));
          stopped = true;
          clearInterval(id);
        }
      } catch {
        // transient/abort
      }
    }, 10_000);
    return () => {
      if (!stopped) controller.abort();
      clearInterval(id);
    };
  }, []);

  if (!delta) return null;
  return (
    <div
      aria-live="polite"
      className="flex items-center justify-between gap-stack-md rounded-xl bg-primary/10 p-stack-md"
    >
      <span className="flex items-center gap-stack-sm text-body-md text-primary">
        <Icon name="check_circle" filled />
        Deposit detected: +{delta}
      </span>
      <Link
        href="/payer/dashboard"
        className="inline-flex min-h-11 items-center rounded-full bg-primary px-stack-md py-2 font-display font-bold text-on-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
      >
        Go to dashboard
      </Link>
    </div>
  );
}
