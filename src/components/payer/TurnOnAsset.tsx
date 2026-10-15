"use client";
import { useState } from "react";
import { Button, Icon } from "@/components/ui";

/**
 * Lets a payer switch on an issued asset such as USDC. On Stellar that is a
 * one-time `change_trust` from the payer's wallet; until it exists the network
 * refuses any incoming payment of the asset. Once on, it shows the transaction
 * that did it, when HeyPay has it, and no button.
 */
export function TurnOnAsset({
  asset,
  on,
  txUrl = null,
  onTurnedOn,
}: {
  asset: string;
  on: boolean;
  /** Block-explorer link to the change_trust transaction, when it is known. */
  txUrl?: string | null;
  onTurnedOn?: (txUrl: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set by a click on this page; the props describe what was true at page load.
  const [turnedOn, setTurnedOn] = useState<{ txUrl: string | null } | null>(null);

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/trustline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ asset }),
      });
      const body = (await res.json().catch(() => null)) as {
        txUrl?: string | null;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(body?.error?.message ?? `Could not turn on ${asset}.`);
        return;
      }
      const url = body?.txUrl ?? null;
      setTurnedOn({ txUrl: url });
      onTurnedOn?.(url);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (on || turnedOn) {
    const link = turnedOn?.txUrl ?? txUrl;
    return (
      <p
        aria-live="polite"
        className="flex flex-wrap items-center gap-stack-sm text-body-md text-primary"
      >
        <Icon name="check_circle" filled />
        {asset} is on
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded underline focus:outline-none focus:ring-4 focus:ring-primary/10"
          >
            View transaction
          </a>
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-stack-md">
      <p className="text-body-md">
        Turn on {asset} so your wallet can hold it. This is a one-time step that sets aside 0.5 XLM
        and costs a small network fee.
      </p>
      <Button type="button" size="md" onClick={turnOn} loading={busy} trailingIcon="link">
        {busy ? "Turning on…" : `Turn on ${asset}`}
      </Button>
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
