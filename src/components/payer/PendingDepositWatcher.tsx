"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Icon } from "@/components/ui";
import { dec, displayXlm } from "@/lib/money";

export function PendingDepositWatcher({ initialBalance }: { initialBalance: string }) {
  const [delta, setDelta] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/wallet/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ctrl.signal,
        });
        if (res.ok) {
          const { balanceXlm } = (await res.json()) as { balanceXlm: string };
          const d = dec(balanceXlm).minus(initialBalance);
          if (d.greaterThan(0)) {
            setDelta(displayXlm(d));
            stopped = true;
            return;
          }
        }
      } catch {
        // transient → keep watching
      }
      if (!stopped) timer = setTimeout(poll, 10_000);
    };

    timer = setTimeout(poll, 10_000);
    return () => {
      stopped = true;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [initialBalance]);

  if (!delta) {
    return (
      <p className="text-center text-body-sm text-on-surface-variant">
        Waiting for your deposit… we check automatically.
      </p>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-stack-md rounded-xl bg-primary/10 p-stack-lg text-center"
    >
      <Icon name="check_circle" filled className="text-4xl text-primary" />
      <p className="font-display text-primary">Deposit detected: +{delta}</p>
      <Link href="/payer/dashboard">
        <Button variant="primary-pill" trailingIcon="arrow_forward">
          Go to dashboard
        </Button>
      </Link>
    </div>
  );
}
