export function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: string;
}) {
  return (
    <div className="tonal-card rounded-lg p-stack-lg">
      <div className="flex items-center justify-between">
        <span className="text-label-md uppercase text-on-surface-variant">{label}</span>
        <span className="material-symbols-outlined text-primary" aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className="mt-stack-sm font-display text-headline-lg text-on-surface">{value}</p>
      {sub ? <p className="mt-1 font-mono text-mono-data text-on-surface-variant">{sub}</p> : null}
    </div>
  );
}
