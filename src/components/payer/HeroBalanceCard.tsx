import Link from "next/link";
import { Icon, TonalCard } from "@/components/ui";
import { HoldingsLive, type HoldingsSnapshot } from "./HoldingsLive";

// On a phone the actions share one row as icon-over-label tiles, so a third one
// never wraps onto a row of its own; from `sm` up they are pills.
const action =
  "inline-flex min-h-11 min-w-0 flex-col-reverse items-center justify-center gap-1 rounded-2xl px-stack-sm py-3 " +
  "font-display text-body-sm font-bold sm:flex-row sm:gap-stack-sm sm:rounded-full sm:px-stack-lg sm:py-4 sm:text-body-md";
const primaryPill = `${action} bg-primary text-on-primary shadow-lg shadow-primary/20 hover:brightness-110`;
const outlinePill = `${action} border-2 border-primary text-primary hover:bg-primary/5`;

export function HeroBalanceCard({
  holdings,
  live = true,
}: {
  holdings: HoldingsSnapshot;
  live?: boolean;
}) {
  // Swaps are between XLM and USDC, so they are offered once USDC is in the wallet's list.
  const canSwap = holdings.tokens.some((t) => t.asset === "USDC");
  return (
    <TonalCard className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/5 blur-3xl"
      />
      <HoldingsLive initial={holdings} live={live} />
      <div className="mt-stack-lg grid auto-cols-fr grid-flow-col gap-stack-sm sm:flex sm:flex-wrap sm:gap-stack-md">
        <Link href="/payer/prefund" className={primaryPill}>
          Prefund
          <Icon name="add_circle" />
        </Link>
        <Link href="/payer/scan" className={outlinePill}>
          Send
          <Icon name="send" />
        </Link>
        {canSwap && (
          <Link href="/payer/swap" className={outlinePill}>
            Swap
            <Icon name="swap_horiz" />
          </Link>
        )}
      </div>
    </TonalCard>
  );
}
