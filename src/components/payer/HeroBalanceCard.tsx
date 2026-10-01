import Link from "next/link";
import { Icon, TonalCard } from "@/components/ui";
import { HoldingsLive, type HoldingsSnapshot } from "./HoldingsLive";

const PILL_FOCUS = "focus:outline-none focus:ring-4 focus:ring-primary/10";
const primaryPill =
  `inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-primary px-stack-lg py-4 font-display ` +
  `font-bold text-on-primary shadow-lg shadow-primary/20 hover:brightness-110 ${PILL_FOCUS}`;
const outlinePill =
  `inline-flex min-h-11 items-center gap-stack-sm rounded-full border-2 border-primary px-stack-lg py-4 ` +
  `font-display font-bold text-primary hover:bg-primary/5 ${PILL_FOCUS}`;

export function HeroBalanceCard({
  holdings,
  live = true,
}: {
  holdings: HoldingsSnapshot;
  live?: boolean;
}) {
  return (
    <TonalCard className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/5 blur-3xl"
      />
      <HoldingsLive initial={holdings} live={live} />
      <div className="mt-stack-lg flex flex-wrap gap-stack-md">
        <Link href="/payer/prefund" className={primaryPill}>
          Prefund
          <Icon name="add_circle" />
        </Link>
        <Link href="/payer/scan" className={outlinePill}>
          Send
          <Icon name="send" />
        </Link>
      </div>
    </TonalCard>
  );
}
