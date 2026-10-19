"use client";
import { useState } from "react";
import { Icon } from "@/components/ui";
import { dec, Decimal } from "@/lib/money";

// PHP carries centavos.
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Parses the typed amount, or null while it is empty or not a positive number. */
function parseAmount(value: string): Decimal | null {
  if (!/^\d*\.?\d+$|^\d+\.$/.test(value)) return null;
  const d = dec(value);
  return d.greaterThan(0) ? d : null;
}

/**
 * Asks for the amount of a QR code that carries none. The shop is paid in
 * pesos, so pesos are all that is asked for here: which asset pays for it, and
 * how much of that asset, are on the confirm step.
 */
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
    const amount = parseAmount(value);
    if (amount === null) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!AMOUNT_PATTERN.test(value)) {
      setError("Use at most 2 decimal places.");
      return;
    }
    setError(null);
    onSubmit(amount.toFixed(2));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-stack-md">
      <label htmlFor="pay-amount" className="text-body-sm text-on-surface-variant">
        Amount to pay (PHP)
      </label>
      <input
        id="pay-amount"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value.trim())}
        placeholder="0.00"
        aria-describedby="pay-amount-hint"
        className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-3 font-mono text-mono-data"
      />
      <p id="pay-amount-hint" className="text-body-sm text-on-surface-variant">
        The crypto amount and the exact rate are shown on the next step.
      </p>
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        aria-busy={busy || undefined}
        disabled={busy}
        className="inline-flex min-h-11 items-center justify-center gap-stack-sm rounded-full bg-primary px-stack-lg py-4 font-display font-bold text-on-primary disabled:opacity-60"
      >
        Continue
        <Icon name="arrow_forward" />
      </button>
    </form>
  );
}
