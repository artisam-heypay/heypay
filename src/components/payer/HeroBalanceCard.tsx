import Link from "next/link";
import { Button, TonalCard } from "@/components/ui";
import { BalanceLive } from "./BalanceLive";

export function HeroBalanceCard({
  availableXlm,
  approxPhp,
}: {
  availableXlm: string;
  approxPhp: string;
}) {
  return (
    <TonalCard className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/5 blur-3xl"
      />
      <p className="text-label-md uppercase text-on-surface-variant">Total Balance</p>
      <div className="mt-stack-sm">
        <BalanceLive initialXlm={availableXlm} initialPhp={approxPhp} />
      </div>
      <div className="mt-stack-lg flex flex-wrap gap-stack-md">
        <Link href="/payer/prefund">
          <Button variant="primary-pill" trailingIcon="add_circle">
            Prefund
          </Button>
        </Link>
        <Link href="/payer/scan">
          <Button variant="outline-pill" trailingIcon="send">
            Send
          </Button>
        </Link>
      </div>
    </TonalCard>
  );
}
