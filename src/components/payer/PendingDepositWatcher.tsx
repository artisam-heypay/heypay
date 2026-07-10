"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { dec, displayAsset } from "@/lib/money";
import { Icon } from "@/components/ui";

type SyncResponse = { balanceXlm: string; balances?: Record<string, string> };

/**
 * Polls the deposit sync for a credit in `asset` and announces the first one it
 * sees. Watching one asset at a time mirrors the deposit address on screen: the
 * payer is told to send that asset, so that's the balance we expect to move.
 */
export function PendingDepositWatcher({
  initialBalance,
  asset = "XLM",
}: {
  initialBalance: string;
  asset?: string;
}) {
  const [delta, setDelta] = useState<string | null>(null);
  const baseRef = useRef(dec(initialBalance));

  useEffect(() => {
    // Switching asset re-baselines: a USDC balance is not a delta on the XLM one.
    baseRef.current = dec(initialBalance);
    setDelta(null);
  }, [asset, initialBalance]);

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
        const body = (await res.json()) as SyncResponse;
        const current = body.balances?.[asset] ?? (asset === "XLM" ? body.balanceXlm : null);
        if (current === null) return;
        const diff = dec(current).minus(baseRef.current);
        if (diff.greaterThan(0)) {
          setDelta(displayAsset(diff, asset));
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
  }, [asset]);

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
