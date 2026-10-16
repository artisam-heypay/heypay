"use client";
import { useEffect, useState } from "react";
import { WALLET_UPDATED_EVENT, type HoldingsSnapshot } from "./HoldingsLive";

/**
 * A wallet's holdings, read again from `url` when the payer comes back to the
 * tab, after anything that moves a balance, and every `everyMs` while the tab
 * is visible. `read` turns the response into a snapshot, or undefined to keep
 * the one shown (a failed read never blanks a balance).
 */
export function useLiveHoldings<T extends HoldingsSnapshot | null>(
  initial: T,
  url: string,
  read: (body: unknown) => T | undefined,
  everyMs: number,
): T {
  const [snapshot, setSnapshot] = useState(initial);

  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return;
        const next = read(await res.json());
        if (next !== undefined) setSnapshot(next);
      } catch {
        // network/abort: keep the last known value
      }
    }
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = setInterval(tick, everyMs);
    window.addEventListener("focus", tick);
    window.addEventListener(WALLET_UPDATED_EVENT, tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      controller.abort();
      clearInterval(id);
      window.removeEventListener("focus", tick);
      window.removeEventListener(WALLET_UPDATED_EVENT, tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [url, read, everyMs]);

  return snapshot;
}
