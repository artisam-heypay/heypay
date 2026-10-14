import { dec, displayAsset } from "@/lib/money";
import { Card, Icon } from "@/components/ui";
import type { HoldingsSnapshot } from "./HoldingsLive";
import { WalletModeButton } from "./WalletModeButton";

/**
 * The payer's connected Freighter wallet on the dashboard while their payments
 * come from the HeyPay wallet: one line saying it is connected but not used,
 * with a way to pay from it instead. Its XLM is read from Stellar; it is left
 * out when Stellar cannot be read.
 */
export function FreighterStrip({
  address,
  holdings,
}: {
  address: string;
  holdings: HoldingsSnapshot | null;
}) {
  const xlm = holdings?.tokens.find((t) => t.asset === "XLM");
  return (
    <Card className="flex flex-wrap items-center justify-between gap-stack-md py-stack-md">
      <div className="flex min-w-0 items-center gap-stack-sm">
        <Icon name="account_balance_wallet" className="text-primary" />
        <p className="min-w-0 text-body-md">
          <span className="font-bold">Freighter</span>{" "}
          <span className="font-mono text-mono-data text-on-surface-variant">
            {address.slice(0, 4)}…{address.slice(-4)}
          </span>
          {xlm && (
            <>
              {" · "}
              <span className="font-mono text-mono-data">
                {displayAsset(dec(xlm.balance), "XLM")}
              </span>
            </>
          )}
          <span className="text-on-surface-variant"> · connected, not used for payments</span>
        </p>
      </div>
      <WalletModeButton to="EXTERNAL">Pay from Freighter</WalletModeButton>
    </Card>
  );
}
