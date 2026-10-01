"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EarningsBucket, EarningsPoint } from "@/server/merchant/service";

// One series, so one hue. The brand cyan (#00bcd4) fails 3:1 against the card as a
// line; the theme's tertiary teal passes, so the line wears that.
const LINE = "var(--color-tertiary)";
const GRID = "var(--color-outline-variant)";
const SURFACE = "var(--color-surface-container-lowest)";

const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 56 };
const PH_TZ = "Asia/Manila";

const php = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const phpCompact = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatBucket(iso: string, bucket: EarningsBucket, long = false): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions =
    bucket === "hour"
      ? long
        ? { month: "short", day: "numeric", hour: "numeric", timeZone: PH_TZ }
        : { hour: "numeric", timeZone: PH_TZ }
      : bucket === "month"
        ? { month: "short", year: "numeric", timeZone: PH_TZ }
        : { month: "short", day: "numeric", timeZone: PH_TZ };
  const label = new Intl.DateTimeFormat("en-PH", opts).format(d);
  return long && bucket === "week" ? `Week of ${label}` : label;
}

/** A clean axis ceiling: 1, 2, 2.5 or 5 × 10ⁿ at or above `max`. */
function niceMax(max: number): number {
  if (max <= 0) return 100;
  const mag = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * mag >= max) return step * mag;
  return 10 * mag;
}

export function EarningsChart({
  series,
  bucket,
}: {
  series: EarningsPoint[];
  bucket: EarningsBucket;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = useMemo(() => series.map((p) => Number(p.php)), [series]);
  const top = niceMax(Math.max(0, ...values));
  const isEmpty = values.every((v) => v === 0);
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (series.length <= 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;

  const line = values
    .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join("");
  const area =
    values.length > 0
      ? `${line}L${x(values.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`
      : "";
  const ticks = [0, top / 2, top];
  const labelIdx = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])].filter(
    (i) => i >= 0,
  );

  function pick(clientX: number) {
    const rect = wrap.current!.getBoundingClientRect();
    const rel = clientX - rect.left - PAD.left;
    const i = series.length <= 1 ? 0 : Math.round((rel / innerW) * (series.length - 1));
    setActive(Math.min(series.length - 1, Math.max(0, i)));
  }

  function onKey(e: React.KeyboardEvent) {
    if (!series.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(series.length - 1, Math.max(0, (a ?? series.length - 1) + dir)));
    } else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(series.length - 1);
    else if (e.key === "Escape") setActive(null);
  }

  const a = active !== null ? series[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(x(active), 80), width - 80) : 0;

  return (
    <div className="tonal-card rounded-xl p-stack-lg">
      <div className="mb-stack-md">
        <h2 className="text-headline-md">Settled payouts</h2>
        <p className="text-body-sm text-on-surface-variant">
          PHP paid out to your account, by {bucket} (Philippine time)
        </p>
      </div>

      <div
        ref={wrap}
        className="relative touch-pan-y select-none overflow-hidden rounded-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/20"
        tabIndex={0}
        role="img"
        aria-label={`Settled payouts chart, ${series.length} points. Use arrow keys to read values.`}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={HEIGHT} className="block" aria-hidden>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke={GRID}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-on-surface-variant text-[11px]"
              >
                {phpCompact.format(t)}
              </text>
            </g>
          ))}
          {labelIdx.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={HEIGHT - 8}
              textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"}
              className="fill-on-surface-variant text-[11px]"
            >
              {formatBucket(series[i]!.t, bucket)}
            </text>
          ))}
          {!isEmpty && <path d={area} fill={LINE} fillOpacity={0.1} />}
          <path
            d={line}
            fill="none"
            stroke={LINE}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={isEmpty ? 0.35 : 1}
          />
          {active !== null && (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={PAD.top + innerH}
                stroke="var(--color-outline)"
                strokeWidth={1}
              />
              <circle cx={x(active)} cy={y(values[active]!)} r={6} fill={SURFACE} />
              <circle cx={x(active)} cy={y(values[active]!)} r={4} fill={LINE} />
            </g>
          )}
        </svg>

        {isEmpty && (
          <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-body-sm text-on-surface-variant">
            No payouts settled in this period
          </p>
        )}

        {a && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-stack-sm shadow-sm"
            style={{ left: tipLeft }}
          >
            <p className="flex items-center gap-stack-sm font-mono text-body-md font-semibold text-on-surface">
              <span
                className="inline-block h-0.5 w-3 rounded"
                style={{ background: LINE }}
                aria-hidden
              />
              {php.format(Number(a.php))}
            </p>
            <p className="text-body-sm text-on-surface-variant">
              {formatBucket(a.t, bucket, true)}
            </p>
          </div>
        )}
      </div>

      <details className="mt-stack-md">
        <summary className="cursor-pointer text-body-sm text-primary">View as table</summary>
        <div className="mt-stack-sm max-h-64 overflow-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-on-surface-variant">
                <th className="py-1 font-medium">Period</th>
                <th className="py-1 text-right font-medium">Settled (PHP)</th>
              </tr>
            </thead>
            <tbody>
              {series.map((p) => (
                <tr key={p.t} className="border-t border-outline-variant/50">
                  <td className="py-1">{formatBucket(p.t, bucket, true)}</td>
                  <td className="py-1 text-right font-mono">{php.format(Number(p.php))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
