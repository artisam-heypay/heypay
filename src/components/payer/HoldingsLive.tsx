"use client";
import { useEffect, useState } from "react";
import { dec, displayAsset, displayPhp } from "@/lib/money";

export type HoldingRow = {
  asset: string;
  /** 7dp string. */
  balance: string;
  /** 2dp string, or null when the rail cannot price this token. */
  valuePhp: string | null;
};

export type HoldingsSnapshot = {
  totalPhp: string;
  tokens: HoldingRow[];
  hasUnpricedBalance: boolean;
};

/**
 * The payer's portfolio: total value on top, one row per token beneath.
 *
 * A token with no rate shows its balance and a dash instead of a peso figure,
 * and sits outside the total — pretending an unpriced balance is worth ₱0 would
 * misstate the total downwards.
 */
export function HoldingsLive({
  initial,
  live = true,
}: {
  initial: HoldingsSnapshot;
  live?: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initial);

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    async function refresh() {
      try {
        const res = await fetch("/api/wallet", { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as {
          totalPhp: string;
          hasUnpricedBalance: boolean;
          assets: { asset: string; balance: string; valuePhp: string | null }[];
        };
        setSnapshot({
          totalPhp: data.totalPhp,
          hasUnpricedBalance: data.hasUnpricedBalance,
          tokens: data.assets.map((a) => ({
            asset: a.asset,
            balance: a.balance,
            valuePhp: a.valuePhp,
          })),
        });
      } catch {
        // network/abort — keep the last known value
      }
    }
    const id = setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      clearInterval(id);
      window.removeEventListener("focus", refresh);
    };
  }, [live]);

  return (
    <div>
      <p className="text-label-md uppercase text-on-surface-variant">Total Balance</p>
      <p className="font-mono text-display-lg text-primary">{displayPhp(dec(snapshot.totalPhp))}</p>
      {snapshot.hasUnpricedBalance && (
        <p className="text-body-sm text-on-surface-variant">
          Excludes tokens with no available rate.
        </p>
      )}

      <ul className="mt-stack-md divide-y divide-outline-variant">
        {snapshot.tokens.map((t) => (
          <li
            key={t.asset}
            className="flex items-center justify-between gap-stack-md py-stack-sm"
            data-testid={`holding-${t.asset}`}
          >
            <div className="flex items-center gap-stack-sm">
              <span
                aria-hidden
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 font-display text-label-md font-bold text-primary"
              >
                {t.asset.slice(0, 1)}
              </span>
              <div>
                <p className="font-display text-body-md font-bold">{t.asset}</p>
                <p className="font-mono text-mono-data text-on-surface-variant">
                  {displayAsset(dec(t.balance), t.asset)}
                </p>
              </div>
            </div>
            <span className="font-mono text-mono-data text-on-surface">
              {t.valuePhp === null ? (
                <span className="text-on-surface-variant" title="No exchange rate available">
                  —
                </span>
              ) : (
                `≈ ${displayPhp(dec(t.valuePhp))}`
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
