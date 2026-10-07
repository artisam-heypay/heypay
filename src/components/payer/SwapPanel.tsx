"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, FloatingInput, Icon } from "@/components/ui";
import { swapAmountSchema, type SwapQuoteResponse, type SwapResponse } from "@/lib/swap";
import { AssetPicker } from "./AssetPicker";
import { TurnOnAsset } from "./TurnOnAsset";

type SwapAsset = "XLM" | "USDC";
type ApiError = { error?: { message?: string; details?: { reason?: string } } };

/** How long to wait after the last keystroke before asking for a quote. */
const QUOTE_DELAY_MS = 400;
/** A quote left on screen is asked for again this often, so it stays current. */
const QUOTE_REFRESH_MS = 15_000;

const other = (asset: SwapAsset): SwapAsset => (asset === "XLM" ? "USDC" : "XLM");

/**
 * Swaps XLM for USDC or USDC for XLM inside the payer's wallet. Until USDC is
 * turned on the wallet can neither receive nor hold it, so the form is replaced
 * by the one step that fixes that.
 */
export function SwapPanel({
  balances,
  usdcOn,
  trustlineTxUrl = null,
}: {
  /** What the wallet can spend of each asset, 7dp strings. */
  balances: Record<SwapAsset, string>;
  usdcOn: boolean;
  trustlineTxUrl?: string | null;
}) {
  const router = useRouter();
  const [on, setOn] = useState(usdcOn);

  if (!on) {
    return (
      <Card className="flex flex-col gap-stack-md">
        <h2 className="font-display text-headline-md">Turn on USDC to swap</h2>
        <TurnOnAsset
          asset="USDC"
          on={false}
          txUrl={trustlineTxUrl}
          onTurnedOn={() => {
            setOn(true);
            router.refresh();
          }}
        />
      </Card>
    );
  }
  return <SwapForm balances={balances} onSwapped={() => router.refresh()} />;
}

function SwapForm({
  balances,
  onSwapped,
}: {
  balances: Record<SwapAsset, string>;
  onSwapped: () => void;
}) {
  const [from, setFrom] = useState<SwapAsset>("XLM");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  // Bumped to ask for the same quote again after the price changed.
  const [quoteRound, setQuoteRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SwapResponse | null>(null);

  const to = other(from);
  const valid = swapAmountSchema.safeParse(amount).success;

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    async function load() {
      setQuoting(true);
      try {
        const params = new URLSearchParams({ from, amount: amount.trim() });
        const res = await fetch(`/api/wallet/swap/quote?${params}`, { signal: controller.signal });
        const body = (await res.json().catch(() => null)) as (SwapQuoteResponse & ApiError) | null;
        if (controller.signal.aborted) return;
        if (!res.ok || !body) {
          setQuote(null);
          setQuoteError(body?.error?.message ?? "Could not get a price. Try again.");
          return;
        }
        setQuote(body);
        setQuoteError(null);
      } catch {
        if (controller.signal.aborted) return;
        setQuote(null);
        setQuoteError("Network error. Try again.");
      } finally {
        if (!controller.signal.aborted) setQuoting(false);
      }
    }
    const first = setTimeout(load, QUOTE_DELAY_MS);
    const refresh = setInterval(load, QUOTE_REFRESH_MS);
    return () => {
      controller.abort();
      clearTimeout(first);
      clearInterval(refresh);
    };
  }, [from, amount, valid, quoteRound]);

  function reset(next: { from?: SwapAsset; amount?: string }) {
    if (next.from) setFrom(next.from);
    if (next.amount !== undefined) setAmount(next.amount);
    // The quote on screen was for the old numbers.
    setQuote(null);
    setQuoteError(null);
    setError(null);
    setDone(null);
  }

  async function swap() {
    if (!quote) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/wallet/swap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, amount: quote.amount, minReceived: quote.minReceived }),
      });
      const body = (await res.json().catch(() => null)) as (SwapResponse & ApiError) | null;
      if (!res.ok || !body) {
        setError(body?.error?.message ?? "The swap did not go through. Try again.");
        // A failed swap can still have cost the network fee.
        onSwapped();
        setQuoteRound((n) => n + 1);
        return;
      }
      setDone(body);
      setAmount("");
      setQuote(null);
      onSwapped();
    } catch {
      setError("Network error. Check your swaps below before trying again.");
      onSwapped();
    } finally {
      setBusy(false);
    }
  }

  // Shown only for the numbers still in the form.
  const current =
    valid && quote?.from === from && Number(quote.amount) === Number(amount) ? quote : null;

  return (
    <Card className="flex flex-col gap-stack-lg">
      <AssetPicker
        label="Swap from"
        options={(["XLM", "USDC"] as const).map((asset) => ({
          asset,
          balance: `${balances[asset]} ${asset}`,
        }))}
        value={from}
        onChange={(asset) => reset({ from: asset as SwapAsset })}
        busy={busy}
      />

      <div className="flex flex-col gap-stack-sm">
        <FloatingInput
          id="swap-amount"
          label={`Amount in ${from}`}
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          disabled={busy}
          onChange={(e) => reset({ amount: e.target.value })}
          aria-describedby="swap-direction"
        />
        <p id="swap-direction" className="text-body-sm text-on-surface-variant">
          {from} to {to}
        </p>
      </div>

      <div aria-live="polite" className="flex flex-col gap-stack-sm">
        {current ? (
          <>
            <dl className="flex flex-col gap-stack-sm rounded-lg bg-surface-container-low p-stack-md">
              {current.mode === "strict_send" ? (
                <QuoteRow label="You get about" value={`${current.estimated} ${to}`} />
              ) : (
                <QuoteRow label="You pay at most" value={`${current.amount} ${from}`} />
              )}
              <QuoteRow label="Minimum received" value={`${current.minReceived} ${to}`} strong />
            </dl>
            <p className="text-body-sm text-on-surface-variant">
              {current.mode === "strict_send"
                ? `You pay exactly ${current.amount} ${from}. If the price moves and you would get less than the minimum, nothing is swapped.`
                : `You receive exactly the minimum. Any ${from} the swap does not need stays in your wallet.`}
            </p>
          </>
        ) : (
          valid && (
            <p className="text-body-sm text-on-surface-variant">
              {quoteError ?? (quoting ? "Getting a price…" : "")}
            </p>
          )
        )}
      </div>

      <Button
        type="button"
        onClick={swap}
        loading={busy}
        disabled={!current}
        trailingIcon="swap_horiz"
      >
        {busy ? "Swapping…" : `Swap to ${to}`}
      </Button>

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
      {done && (
        <div role="status" className="flex items-start gap-stack-sm text-body-md text-primary">
          <Icon name="check_circle" filled />
          <p>
            Swapped {done.sent} {done.from} for {done.received} {done.to}.{" "}
            <a
              href={done.txUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded underline focus:outline-none focus:ring-4 focus:ring-primary/10"
            >
              View transaction
            </a>
          </p>
        </div>
      )}
    </Card>
  );
}

function QuoteRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-stack-md">
      <dt className="text-body-sm text-on-surface-variant">{label}</dt>
      <dd className={strong ? "font-mono text-mono-data font-bold" : "font-mono text-mono-data"}>
        {value}
      </dd>
    </div>
  );
}
