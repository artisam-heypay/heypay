"use client";
import { useState } from "react";
import { Icon } from "@/components/ui";

export function AmountPrompt({
  onSubmit,
  busy,
}: {
  onSubmit: (amountPhp: string) => void;
  busy?: boolean;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
      setError("Use at most 2 decimal places.");
      return;
    }
    setError(null);
    onSubmit(value);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-stack-md">
      <label htmlFor="php-amount" className="text-body-sm text-on-surface-variant">
        Amount to pay (PHP)
      </label>
      <input
        id="php-amount"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="0.00"
        className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-3 font-mono text-mono-data focus:outline-none focus:ring-4 focus:ring-primary/10"
      />
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        aria-busy={busy || undefined}
        disabled={busy}
        className="inline-flex min-h-11 items-center justify-center gap-stack-sm rounded-full bg-primary px-stack-lg py-4 font-display font-bold text-on-primary disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-primary/10"
      >
        Continue
        <Icon name="arrow_forward" />
      </button>
    </form>
  );
}
