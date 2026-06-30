export function ProgressBar({ step, total = 4 }: { step: number; total?: number }) {
  return (
    <div
      className="flex gap-stack-sm"
      role="progressbar"
      aria-valuenow={step}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={`Step ${step} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          data-testid="progress-seg"
          className={`h-1.5 flex-1 rounded-full ${i < step ? "bg-primary" : "bg-surface-container-high"}`}
        />
      ))}
    </div>
  );
}
