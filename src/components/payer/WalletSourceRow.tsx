import Link from "next/link";
import { Icon, MoneyAmount } from "@/components/ui";
import type { Decimal } from "@/lib/money";

export function WalletSourceRow({
  publicKey,
  availableAsset,
  approxPhp,
  requiredAsset,
  asset = "XLM",
}: {
  publicKey: string;
  availableAsset: Decimal;
  approxPhp: Decimal;
  requiredAsset: Decimal;
  asset?: string;
}) {
  const insufficient = availableAsset.lessThan(requiredAsset);
  return (
    <div className="rounded-lg bg-surface-container-highest p-stack-md">
      <div className="flex items-center justify-between gap-stack-md">
        <div className="flex min-w-0 items-center gap-stack-sm">
          <Icon name="account_balance_wallet" className="text-primary" />
          <div className="min-w-0">
            <p className="text-body-md">HeyPay Wallet</p>
            <p className="truncate font-mono text-mono-data text-on-surface-variant">{publicKey}</p>
          </div>
        </div>
        <MoneyAmount xlm={availableAsset} asset={asset} php={approxPhp} size="row" />
      </div>
      {insufficient && (
        <p className="mt-stack-sm text-body-sm text-error">
          Insufficient {asset} balance.{" "}
          <Link href="/payer/prefund" className="underline">
            Prefund your wallet
          </Link>
          .
        </p>
      )}
    </div>
  );
}
