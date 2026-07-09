import Link from "next/link";
import { Icon, MoneyAmount, TonalCard } from "@/components/ui";
import type { Decimal } from "@/lib/money";
import { BalanceLive } from "./BalanceLive";

const PILL_FOCUS = "focus:outline-none focus:ring-4 focus:ring-primary/10";
const primaryPill =
  `inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-primary px-stack-lg py-4 font-display ` +
  `font-bold text-on-primary shadow-lg shadow-primary/20 hover:brightness-110 ${PILL_FOCUS}`;
const outlinePill =
  `inline-flex min-h-11 items-center gap-stack-sm rounded-full border-2 border-primary px-stack-lg py-4 ` +
  `font-display font-bold text-primary hover:bg-primary/5 ${PILL_FOCUS}`;

export function HeroBalanceCard({
  availableXlm,
  approxPhp,
  live = true,
}: {
  availableXlm: Decimal;
  approxPhp: Decimal;
  live?: boolean;
}) {
  return (
    <TonalCard className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/5 blur-3xl"
      />
      <p className="text-label-md uppercase text-on-surface-variant">Total Balance</p>
      <div className="mt-stack-sm">
        {live ? (
          <BalanceLive initialXlm={availableXlm.toFixed(7)} initialPhp={approxPhp.toFixed(2)} />
        ) : (
          <MoneyAmount xlm={availableXlm} php={approxPhp} size="display" />
        )}
      </div>
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
