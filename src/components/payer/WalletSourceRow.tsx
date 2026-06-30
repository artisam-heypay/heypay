import Link from "next/link";
import { Icon, MoneyAmount } from "@/components/ui";
import { type Decimal } from "@/lib/money";

export function WalletSourceRow({
  publicKey,
  availableXlm,
  availablePhp,
  totalXlm,
}: {
  publicKey: string;
  availableXlm: Decimal;
  availablePhp: Decimal;
  totalXlm: Decimal;
}) {
  const insufficient = availableXlm.lessThan(totalXlm);
  return (
    <div className="flex flex-col gap-stack-sm rounded-lg bg-surface-container-highest p-stack-md">
      <p className="text-label-md uppercase text-on-surface-variant">Pay from</p>
      <div className="flex items-center justify-between gap-stack-md">
        <div className="flex min-w-0 items-center gap-stack-sm">
          <Icon name="account_balance_wallet" filled className="text-primary" />
          <div className="min-w-0">
            <p className="font-display">HeyPay Wallet</p>
            <p className="truncate text-mono-data text-body-sm text-on-surface-variant">
              {publicKey}
            </p>
          </div>
        </div>
        <MoneyAmount size="row" xlm={availableXlm} php={availablePhp} />
      </div>
      {insufficient ? (
        <p className="text-body-sm text-error">
          Insufficient balance.{" "}
          <Link href="/payer/prefund" className="underline">
            Prefund your wallet
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
