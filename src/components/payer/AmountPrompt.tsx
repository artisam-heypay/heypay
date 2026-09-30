"use client";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Icon } from "@/components/ui";
import { dec, Decimal, displayPhp, displayXlm } from "@/lib/money";

type Currency = "PHP" | "XLM";

const CURRENCIES: Currency[] = ["PHP", "XLM"];

// PHP carries centavos; XLM is stored to the stroop (7 dp).
const AMOUNT_PATTERN: Record<Currency, RegExp> = {
  PHP: /^\d+(\.\d{1,2})?$/,
  XLM: /^\d+(\.\d{1,7})?$/,
};

type WalletResponse = { assets: { asset: string; rate: string | null; available: string }[] };

/** Parses the typed amount, or null while it is empty or not a positive number. */
function parseAmount(value: string): Decimal | null {
  if (!/^\d*\.?\d+$|^\d+\.$/.test(value)) return null;
  const d = dec(value);
  return d.greaterThan(0) ? d : null;
}

export function AmountPrompt({
  onSubmit,
  busy,
}: {
  onSubmit: (amountPhp: string) => void;
  busy?: boolean;
}) {
  const [currency, setCurrency] = useState<Currency>("PHP");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Reference XLM→PHP rate for the preview. The quote locks the real rate.
  const [rate, setRate] = useState<Decimal | null>(null);
  const [availableXlm, setAvailableXlm] = useState<Decimal | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/wallet", { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as WalletResponse;
        const xlm = data.assets.find((a) => a.asset === "XLM");
        if (xlm?.rate) setRate(dec(xlm.rate));
        if (xlm) setAvailableXlm(dec(xlm.available));
      } catch {
        // The preview is optional; paying in PHP still works without it.
      }
    })();
    return () => controller.abort();
  }, []);

  const amount = parseAmount(value);
  // XLM entry converts down to whole centavos so the payer never owes more XLM
  // than they typed at the preview rate.
  const amountPhp =
    amount === null
      ? null
      : currency === "PHP"
        ? amount
        : rate
          ? amount.times(rate).toDecimalPlaces(2, Decimal.ROUND_DOWN)
          : null;
  const amountXlm =
    amount === null
      ? null
      : currency === "XLM"
        ? amount
        : rate
          ? amount.div(rate).toDecimalPlaces(7, Decimal.ROUND_UP)
          : null;

  function switchCurrency(next: Currency) {
    if (next === currency) return;
    // Carry the amount across so the payer keeps what they meant to pay.
    const carried = next === "PHP" ? amountPhp : amountXlm;
    setValue(carried ? (next === "PHP" ? carried.toFixed(2) : carried.toFixed(7)) : "");
    setCurrency(next);
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (amount === null) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!AMOUNT_PATTERN[currency].test(value)) {
      setError(`Use at most ${currency === "PHP" ? 2 : 7} decimal places.`);
      return;
    }
    if (currency === "XLM" && rate === null) {
      setError("The XLM rate is unavailable right now. Enter the amount in PHP instead.");
      return;
    }
    if (amountPhp === null || amountPhp.lessThanOrEqualTo(0)) {
      setError("That XLM amount is worth less than ₱0.01.");
      return;
    }
    setError(null);
    onSubmit(amountPhp.toFixed(2));
  }

  const overBalance =
    amountXlm !== null && availableXlm !== null && amountXlm.greaterThan(availableXlm);

  return (
    <form onSubmit={submit} className="flex flex-col gap-stack-md">
      <div className="flex items-center justify-between gap-stack-md">
        <label htmlFor="pay-amount" className="text-body-sm text-on-surface-variant">
          Amount to pay ({currency})
        </label>
        <div
          role="radiogroup"
          aria-label="Currency"
          className="inline-flex rounded-full border border-outline-variant p-1"
        >
          {CURRENCIES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === currency}
              disabled={busy}
              onClick={() => switchCurrency(c)}
              className={clsx(
                "min-h-9 rounded-full px-stack-md font-display text-body-sm font-bold",
                "focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:opacity-60",
                c === currency ? "bg-primary text-on-primary" : "text-on-surface-variant",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <input
        id="pay-amount"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value.trim())}
        placeholder={currency === "PHP" ? "0.00" : "0.0000000"}
        className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-3 font-mono text-mono-data focus:outline-none focus:ring-4 focus:ring-primary/10"
      />
      <div aria-live="polite" className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
        {rate ? (
          <>
            {amount !== null && (
              <p className="font-mono text-mono-data text-on-surface">
                ≈{" "}
                {currency === "PHP"
                  ? amountXlm && displayXlm(amountXlm)
                  : amountPhp && displayPhp(amountPhp)}
              </p>
            )}
            <p>1 XLM ≈ {displayPhp(rate)}. The exact rate is locked on the next step.</p>
          </>
        ) : (
          currency === "XLM" && <p>Loading the XLM rate…</p>
        )}
        {availableXlm && <p>Available: {displayXlm(availableXlm)}</p>}
        {overBalance && <p className="text-error">This is more than your available XLM.</p>}
      </div>
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
