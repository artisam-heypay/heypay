"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { dec, displayAsset, displayPhp } from "@/lib/money";
import { Icon, TonalCard } from "@/components/ui";
import { WALLET_UPDATED_EVENT, type HoldingsSnapshot } from "./HoldingsLive";
import { CustodyChip, PaysNowChip } from "./WalletChips";

/** How often an open dashboard reads the payer's own wallet again. */
const REFRESH_MS = 30_000;

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * The payer's own wallet (Freighter) on the dashboard, while their payments
 * come from it. Its balances are read from Stellar by address: HeyPay keeps no
 * balance for it and holds no key to it. When Stellar cannot be read the card
 * says so instead of showing zero.
 */
export function OwnWalletBalance({
  address,
  explorerUrl,
  initial,
}: {
  address: string;
  /** The account on stellar.expert, for the network the app runs on. */
  explorerUrl: string;
  /** What the wallet held when the page was drawn; null when Stellar could not be read. */
  initial: HoldingsSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const res = await fetch("/api/wallet/external", { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { holdings: HoldingsSnapshot | null; readable: boolean };
        // A failed read keeps the last balance shown, if there is one.
        if (data.readable) setSnapshot(data.holdings);
      } catch {
        // network/abort: keep the last known value
      }
    }
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = setInterval(tick, REFRESH_MS);
    window.addEventListener("focus", tick);
    window.addEventListener(WALLET_UPDATED_EVENT, tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      controller.abort();
      clearInterval(id);
      window.removeEventListener("focus", tick);
      window.removeEventListener(WALLET_UPDATED_EVENT, tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused: the full address is on screen to select by hand.
    }
  }

  const xlm = snapshot?.tokens.find((t) => t.asset === "XLM");

  return (
    <TonalCard className="flex flex-col gap-stack-md">
      <div className="flex flex-wrap items-center justify-between gap-stack-sm">
        <h2 className="font-display text-headline-md">Your wallet · Freighter</h2>
        <div className="flex flex-wrap gap-stack-sm">
          <PaysNowChip />
          <CustodyChip holder="you" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-stack-sm">
        <span
          className="break-all font-mono text-mono-data text-on-surface-variant"
          title={address}
        >
          <span className="sm:hidden">{shortAddress(address)}</span>
          <span className="hidden sm:inline">{address}</span>
        </span>
        <button
          type="button"
          onClick={copyAddress}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-primary hover:bg-primary/5 focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          <Icon name={copied ? "check" : "content_copy"} />
          <span className="sr-only">{copied ? "Address copied" : "Copy address"}</span>
        </button>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded text-body-sm text-primary underline-offset-2 hover:underline focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          View on Stellar
          <Icon name="open_in_new" className="text-base" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>

      {snapshot ? (
        <div>
          <p className="text-label-md uppercase text-on-surface-variant">Balance</p>
          <p className="font-mono text-display-lg text-primary">
            {displayPhp(dec(snapshot.totalPhp))}
          </p>
          {snapshot.hasUnpricedBalance && (
            <p className="text-body-sm text-on-surface-variant">
              Excludes tokens with no available rate.
            </p>
          )}
          <ul className="mt-stack-md divide-y divide-outline-variant">
            {snapshot.tokens.map((t) => (
              <li
                key={t.asset}
                className="flex items-center justify-between gap-stack-md py-stack-sm"
                data-testid={`own-holding-${t.asset}`}
              >
                <div className="min-w-0">
                  <p className="font-display text-body-md font-bold">{t.asset}</p>
                  <p className="font-mono text-mono-data text-on-surface-variant">
                    {displayAsset(dec(t.balance), t.asset)}
                  </p>
                  {t.canReceive === false && (
                    <p className="text-body-sm text-on-surface-variant">
                      Add {t.asset} in Freighter to pay with it.
                    </p>
                  )}
                </div>
                <p className="shrink-0 font-mono text-mono-data">
                  {t.valuePhp === null ? (
                    <span className="text-on-surface-variant" title="No exchange rate available">
                      —
                    </span>
                  ) : (
                    `≈ ${displayPhp(dec(t.valuePhp))}`
                  )}
                </p>
              </li>
            ))}
          </ul>
          {xlm?.available && (
            <p className="mt-stack-sm text-body-sm text-on-surface-variant">
              Spendable now:{" "}
              <span className="font-mono text-on-surface">
                {displayAsset(dec(xlm.available), "XLM")}
              </span>
              , after Stellar&apos;s minimum balance and the network fees a payment needs.
            </p>
          )}
        </div>
      ) : (
        <p role="status" className="text-body-md text-on-surface-variant">
          Your wallet could not be read from Stellar just now, so its balance is not shown. It will
          be read again shortly.
        </p>
      )}

      <p className="text-body-sm text-on-surface-variant">
        Read from Stellar. HeyPay does not hold this money.
      </p>

      <div className="flex flex-wrap items-start gap-stack-md">
        <Link
          href="/payer/scan"
          className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-primary px-stack-lg py-3 font-display font-bold text-on-primary shadow-lg shadow-primary/20 hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          Scan to pay
          <Icon name="qr_code_scanner" />
        </Link>
      </div>
    </TonalCard>
  );
}
