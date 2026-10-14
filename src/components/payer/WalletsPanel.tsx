"use client";
import { useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { dec, displayPhp } from "@/lib/money";
import { Icon } from "@/components/ui";
import type { HoldingsSnapshot } from "./HoldingsLive";
import { useLiveHoldings } from "./useLiveHoldings";
import { WalletModeButton } from "./WalletModeButton";

/** The payer's own wallet, when one is connected. */
export type OwnWalletView = {
  address: string;
  /** What it held when the page was drawn; null when Stellar could not be read. */
  holdings: HoldingsSnapshot | null;
};

const iconButton =
  "-my-3 inline-flex h-11 w-11 items-center justify-center rounded-lg text-primary " +
  "hover:bg-primary/5 focus:outline-none focus:ring-4 focus:ring-primary/10";

const pill =
  "inline-flex min-h-11 items-center gap-stack-sm rounded-full px-stack-md py-2 font-display font-bold " +
  "focus:outline-none focus:ring-4 focus:ring-primary/10";

const amount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

// Each wallet is read again on its own: HeyPay's ledger is cheap to ask, the
// chain less so.
function readHeyPay(body: unknown): HoldingsSnapshot | undefined {
  const data = body as {
    totalPhp?: string;
    hasUnpricedBalance?: boolean;
    assets?: { asset: string; balance: string; valuePhp: string | null; rate: string | null }[];
  } | null;
  if (!data?.assets || data.totalPhp === undefined) return undefined;
  return {
    totalPhp: data.totalPhp,
    hasUnpricedBalance: Boolean(data.hasUnpricedBalance),
    tokens: data.assets.map((a) => ({
      asset: a.asset,
      balance: a.balance,
      valuePhp: a.valuePhp,
      rate: a.rate,
    })),
  };
}

function readOwn(body: unknown): HoldingsSnapshot | null | undefined {
  const data = body as { holdings?: HoldingsSnapshot | null; readable?: boolean } | null;
  // A failed read keeps the balance already shown.
  return data?.readable ? (data.holdings ?? null) : undefined;
}

/**
 * The payer's wallets side by side: their own wallet (Freighter), when one is
 * connected, and the HeyPay wallet. Both are laid out the same way and kept to
 * what a glance needs: whose wallet it is, its balance, and whether payments
 * come from it. The balances are never added together, because who can move
 * the money differs.
 */
export function WalletsPanel({
  paysWithOwn,
  heypay,
  own,
  canSwap,
}: {
  /** Whether payments come from the payer's own wallet rather than the HeyPay wallet. */
  paysWithOwn: boolean;
  heypay: HoldingsSnapshot;
  /** Null when no wallet of their own is connected yet. */
  own: OwnWalletView | null;
  /** Whether the HeyPay wallet can swap (USDC is enabled). */
  canSwap: boolean;
}) {
  return (
    <section aria-labelledby="wallets-heading" className="flex flex-col gap-stack-md">
      <h2 id="wallets-heading" className="font-display text-headline-md">
        Your wallets
      </h2>
      <div className="grid grid-cols-1 gap-stack-md md:grid-cols-2">
        {own ? <OwnWalletCard own={own} selected={paysWithOwn} /> : <ConnectWalletCard />}
        <HeyPayWalletCard holdings={heypay} selected={!paysWithOwn} canSwap={canSwap} />
      </div>
    </section>
  );
}

function OwnWalletCard({ own, selected }: { own: OwnWalletView; selected: boolean }) {
  const holdings = useLiveHoldings(own.holdings, "/api/wallet/external", readOwn, 30_000);
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(own.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused: the full address is in the title and in Settings.
    }
  }

  return (
    <WalletCard
      icon="account_balance_wallet"
      title="Freighter"
      testId="wallet-own"
      subtitle={
        <span className="flex items-center gap-1">
          <span className="whitespace-nowrap font-mono text-mono-data" title={own.address}>
            {shortAddress(own.address)}
          </span>
          <button type="button" onClick={copyAddress} className={iconButton}>
            <Icon name={copied ? "check" : "content_copy"} className="text-lg" />
            <span className="sr-only">{copied ? "Address copied" : "Copy wallet address"}</span>
          </button>
        </span>
      }
      selected={selected}
      holdings={holdings}
      unreadable="Can't read Stellar right now."
      action={selected ? null : <WalletModeButton to="EXTERNAL">Use this wallet</WalletModeButton>}
    />
  );
}

function HeyPayWalletCard({
  holdings: initial,
  selected,
  canSwap,
}: {
  holdings: HoldingsSnapshot;
  selected: boolean;
  canSwap: boolean;
}) {
  const holdings = useLiveHoldings(initial, "/api/wallet", readHeyPay, 15_000);
  return (
    <WalletCard
      icon="account_balance"
      title="HeyPay wallet"
      testId="wallet-heypay"
      subtitle="Held by HeyPay"
      selected={selected}
      holdings={holdings}
      action={
        selected ? (
          <div className="flex flex-wrap gap-stack-sm">
            <Link href="/payer/prefund" className={clsx(pill, "bg-primary text-on-primary")}>
              Prefund
              <Icon name="add_circle" />
            </Link>
            {canSwap && (
              <Link
                href="/payer/swap"
                className={clsx(pill, "border-2 border-primary text-primary hover:bg-primary/5")}
              >
                Swap
                <Icon name="swap_horiz" />
              </Link>
            )}
          </div>
        ) : (
          <WalletModeButton to="CUSTODIAL">Use this wallet</WalletModeButton>
        )
      }
    />
  );
}

/**
 * One wallet, laid out the same way for both kinds: name and owner, whether
 * payments come from it, its balance, and at most one row of actions.
 */
function WalletCard({
  icon,
  title,
  subtitle,
  selected,
  holdings,
  unreadable,
  action,
  testId,
}: {
  icon: string;
  title: string;
  subtitle: React.ReactNode;
  selected: boolean;
  holdings: HoldingsSnapshot | null;
  /** Shown instead of the balance when it could not be read. */
  unreadable?: string;
  action: React.ReactNode;
  testId: string;
}) {
  return (
    <article
      aria-label={`${title}${selected ? ", in use for payments" : ""}`}
      data-testid={testId}
      className={clsx(
        "flex min-w-0 flex-col gap-stack-md rounded-xl p-stack-lg",
        selected
          ? "border-2 border-primary bg-surface-container-lowest shadow-lg shadow-primary/10"
          : "border border-outline-variant bg-surface-container-low",
      )}
    >
      <div className="flex items-start justify-between gap-stack-sm">
        <div className="flex min-w-0 items-center gap-stack-sm">
          <span
            aria-hidden
            className={clsx(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
              selected ? "bg-primary text-on-primary" : "bg-surface-container-high text-outline",
            )}
          >
            <Icon name={icon} />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-body-lg font-bold">{title}</h3>
            <div className="text-body-sm text-on-surface-variant">{subtitle}</div>
          </div>
        </div>
        {selected && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-container px-3 py-1 text-label-md text-on-primary-container">
            <Icon name="check_circle" className="text-base" />
            In use
          </span>
        )}
      </div>

      {holdings ? (
        <div>
          <p
            className={clsx(
              "font-mono text-headline-lg tabular-nums",
              selected ? "text-primary" : "text-on-surface",
            )}
          >
            {displayPhp(dec(holdings.totalPhp))}
          </p>
          <p
            className="font-mono text-body-sm tabular-nums text-on-surface-variant"
            data-testid={`${testId}-assets`}
          >
            {holdings.tokens
              .map((t) => `${amount.format(Number(t.balance))} ${t.asset}`)
              .join(" · ")}
          </p>
        </div>
      ) : (
        <p role="status" className="text-body-md text-on-surface-variant">
          {unreadable}
        </p>
      )}

      {action && <div className="mt-auto">{action}</div>}
    </article>
  );
}

/** Where the payer's own wallet goes when none is connected yet. */
function ConnectWalletCard() {
  return (
    <article
      aria-label="Your own wallet, not connected"
      data-testid="wallet-own-connect"
      className="flex min-w-0 flex-col gap-stack-md rounded-xl border-2 border-dashed border-outline-variant p-stack-lg"
    >
      <div className="flex items-center gap-stack-sm">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-outline"
        >
          <Icon name="account_balance_wallet" />
        </span>
        <div>
          <h3 className="font-display text-body-lg font-bold">Your own wallet</h3>
          <p className="text-body-sm text-on-surface-variant">Pay from Freighter</p>
        </div>
      </div>
      <div className="mt-auto">
        <Link
          href="/payer/settings"
          className={clsx(pill, "border-2 border-primary text-primary hover:bg-primary/5")}
        >
          Connect
          <Icon name="arrow_forward" />
        </Link>
      </div>
    </article>
  );
}
