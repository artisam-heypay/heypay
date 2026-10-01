"use client";
import { useState } from "react";
import { dec } from "@/lib/money";
import { Button, Card, Icon } from "@/components/ui";
import { WALLET_UPDATED_EVENT } from "./HoldingsLive";

/**
 * Testnet faucet: one click drops test XLM into the payer's wallet so they can
 * try a payment straight away. Rendered only while the faucet is enabled and the
 * payer has not claimed yet; after a claim it stays as a receipt until reload.
 */
export function FaucetCard({ amountXlm }: { amountXlm: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txUrl, setTxUrl] = useState<string | null>(null);
  const amount = `${dec(amountXlm).toString()} XLM`;

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/faucet", { method: "POST" });
      const body = (await res.json().catch(() => null)) as {
        txUrl?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not claim test XLM.");
        return;
      }
      setTxUrl(body?.txUrl ?? "");
      window.dispatchEvent(new Event(WALLET_UPDATED_EVENT));
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-stack-md sm:flex-row sm:items-center sm:justify-between">
      {txUrl === null ? (
        <>
          <div className="flex items-start gap-stack-sm">
            <Icon name="water_drop" className="text-primary" />
            <div>
              <h2 className="font-display text-body-lg font-bold">Get {amount} to try HeyPay</h2>
              <p className="text-body-sm text-on-surface-variant">
                Free test XLM on the Stellar testnet. One claim per account.
              </p>
              {error && (
                <p role="alert" className="mt-1 text-body-sm text-error">
                  {error}
                </p>
              )}
            </div>
          </div>
          <Button size="md" onClick={claim} loading={busy} trailingIcon="redeem">
            {busy ? "Claiming…" : `Claim ${amount}`}
          </Button>
        </>
      ) : (
        <p aria-live="polite" className="flex items-center gap-stack-sm text-body-md text-primary">
          <Icon name="check_circle" filled />
          {amount} is on its way to your wallet.
          {txUrl && (
            <a
              href={txUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded underline focus:outline-none focus:ring-4 focus:ring-primary/10"
            >
              View transaction
            </a>
          )}
        </p>
      )}
    </Card>
  );
}
