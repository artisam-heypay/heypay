"use client";
import { useEffect, useRef, useState } from "react";
import type { SystemHealth } from "@/server/admin/health";
import { StatBadge } from "@/components/admin/StatBadge";

const TONE = { ok: "settled", degraded: "pending", down: "error" } as const;
const LABEL = { ok: "OK", degraded: "Degraded", down: "Down" } as const;
const ICON: Record<string, string> = {
  stellar: "star",
  pdax: "currency_exchange",
  redis: "memory",
  queue: "stacks",
};

export function HealthTiles({ initial }: { initial: SystemHealth }) {
  const [health, setHealth] = useState<SystemHealth>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const reduced = useRef(false);
  const fetching = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = setInterval(async () => {
      if (fetching.current) return;
      fetching.current = true;
      setRefreshing(true);
      try {
        const res = await fetch("/api/admin/health", { credentials: "same-origin" });
        if (res.ok) setHealth(await res.json());
      } finally {
        setRefreshing(false);
        fetching.current = false;
      }
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <StatBadge tone={TONE[health.status]}>{LABEL[health.status]}</StatBadge>
        <span
          className="flex items-center gap-stack-sm text-body-sm text-on-surface-variant"
          aria-live="polite"
        >
          {refreshing && !reduced.current ? (
            <span
              className="material-symbols-outlined animate-spin text-primary"
              aria-hidden="true"
            >
              sync
            </span>
          ) : null}
          {refreshing
            ? "Updating…"
            : `Checked ${new Date(health.checkedAt).toISOString().slice(11, 19)} UTC`}
        </span>
      </div>

      <div className="mt-stack-lg grid grid-cols-1 gap-stack-lg sm:grid-cols-2 lg:grid-cols-4">
        {health.components.map((c) => (
          <div key={c.name} className="tonal-card rounded-lg p-stack-lg">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-stack-sm font-display text-headline-md capitalize text-on-surface">
                <span className="material-symbols-outlined text-primary" aria-hidden="true">
                  {ICON[c.name]}
                </span>
                {c.name}
              </span>
              <StatBadge tone={TONE[c.status]}>{LABEL[c.status]}</StatBadge>
            </div>
            <p className="mt-stack-md font-mono text-mono-data text-on-surface-variant">
              {c.detail}
            </p>
            {typeof c.latencyMs === "number" ? (
              <p className="mt-1 font-mono text-mono-data text-outline">{c.latencyMs} ms</p>
            ) : null}
            {typeof c.queueDepth === "number" ? (
              <p className="mt-1 font-mono text-mono-data text-outline">
                Queue depth: {c.queueDepth}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
