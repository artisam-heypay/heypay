import { dec, displayAsset, displayPhp } from "@/lib/money";
import { Card } from "@/components/ui";
import type { HoldingsSnapshot } from "./HoldingsLive";
import { CustodyChip } from "./WalletChips";
import { WalletModeButton } from "./WalletModeButton";

/**
 * The HeyPay wallet on the dashboard while the payer pays from their own
 * wallet: what is still in it, that HeyPay holds its key, and that payments do
 * not use it now. It is shown on its own, never added to the payer's own
 * balance, because who can move the money differs.
 */
export function HeyPayWalletAside({ holdings }: { holdings: HoldingsSnapshot }) {
  return (
    <Card className="flex flex-col gap-stack-md">
      <div className="flex flex-col gap-stack-sm">
        <h2 className="font-display text-body-lg font-bold">HeyPay wallet</h2>
        <div>
          <CustodyChip holder="heypay" />
        </div>
      </div>

      <div>
        <p className="font-mono text-headline-md">{displayPhp(dec(holdings.totalPhp))}</p>
        <ul className="mt-stack-sm flex flex-col gap-1">
          {holdings.tokens.map((t) => (
            <li
              key={t.asset}
              className="flex justify-between gap-stack-md font-mono text-mono-data text-on-surface-variant"
              data-testid={`heypay-holding-${t.asset}`}
            >
              <span>{t.asset}</span>
              <span>{displayAsset(dec(t.balance), t.asset)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-body-sm text-on-surface-variant">
        Not used while you pay from your own wallet. Its balance stays here until you pay from it
        again.
      </p>
      <WalletModeButton to="CUSTODIAL">Pay from HeyPay wallet</WalletModeButton>
    </Card>
  );
}
