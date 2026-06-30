"use client";
import { useState } from "react";
import { Button } from "@/components/ui";

export function AmountPrompt({
  merchantName,
  onSubmit,
  pending,
}: {
  merchantName?: string;
  onSubmit: (amountPhp: string) => void;
  pending?: boolean;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) <= 0) {
      setError("Enter a valid amount (up to 2 decimals).");
      return;
    }
    setError(null);
    onSubmit(value);
  };

  return (
    <form
      className="flex flex-col gap-stack-md"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="amountPhp" className="text-label-md uppercase text-on-surface-variant">
        Amount to pay{merchantName ? ` · ${merchantName}` : ""}
      </label>
      <div className="flex items-center gap-stack-sm rounded-lg border border-outline-variant px-4 py-3">
        <span className="text-headline-md text-on-surface-variant">₱</span>
        <input
          id="amountPhp"
          name="amountPhp"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0.00"
          className="w-full bg-transparent text-mono-data text-headline-md outline-none"
        />
      </div>
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary-pill" trailingIcon="arrow_forward" loading={pending}>
        Continue
      </Button>
    </form>
  );
}
