import Link from "next/link";
import QRCode from "qrcode";
import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { getRecentPayments } from "@/server/payer/data";
import { getHoldings, getOwnWalletHoldings, holdingsSnapshot } from "@/server/payer/holdings";
import { getFaucetStatus } from "@/server/payer/faucet";
import { getOwnWallet, nonCustodialEnabled, ownWalletAccount } from "@/server/wallet/external";
import { stellarAccountUrl } from "@/lib/stellar-explorer";
import { Icon } from "@/components/ui";
import { HeroBalanceCard } from "@/components/payer/HeroBalanceCard";
import { ScanQrphCard } from "@/components/payer/ScanQrphCard";
import { RecentPaymentsList } from "@/components/payer/RecentPaymentsList";
import { PrefundPanel } from "@/components/payer/PrefundPanel";
import { NetworkStatus } from "@/components/payer/NetworkStatus";
import { FaucetCard } from "@/components/payer/FaucetCard";
import { OwnWalletBalance } from "@/components/payer/OwnWalletBalance";
import { HeyPayWalletAside } from "@/components/payer/HeyPayWalletAside";
import { FreighterStrip } from "@/components/payer/FreighterStrip";

export default async function PayerDashboardPage() {
  const user = await requireRole(Role.PAYER);
  // The payer's own wallet, offered while NONCUSTODIAL_ENABLED is on.
  const own = nonCustodialEnabled() ? await getOwnWallet(user.id) : null;
  const connected = own?.externalPublicKey ?? null;
  // Their payments come from it only while they chose it.
  const paysFromOwn = own ? ownWalletAccount(own) : null;

  const [holdings, recent, faucet, ownHoldings] = await Promise.all([
    getHoldings(user.id),
    getRecentPayments(user.id, 5),
    getFaucetStatus(user.id),
    // Read from Stellar; null when it cannot be read, so it is never shown as empty.
    connected ? getOwnWalletHoldings(connected).catch(() => null) : null,
  ]);

  const snapshot = holdingsSnapshot(holdings);
  const ownSnapshot = ownHoldings ? holdingsSnapshot(ownHoldings) : null;

  const header = (
    <div className="flex items-center justify-between">
      <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Dashboard</h1>
      <NetworkStatus />
    </div>
  );

  // Paying from their own wallet: that wallet is the main balance, and the
  // HeyPay wallet is shown apart with what is left in it. The faucet and the
  // deposit address are the HeyPay wallet's, so they are not offered here.
  if (paysFromOwn) {
    return (
      <div className="flex flex-col gap-stack-lg">
        {header}
        <div className="grid grid-cols-1 gap-stack-lg lg:grid-cols-3">
          <div className="lg:col-span-2">
            <OwnWalletBalance
              address={paysFromOwn}
              explorerUrl={stellarAccountUrl(paysFromOwn)}
              initial={ownSnapshot}
            />
          </div>
          <ScanQrphCard />

          <div className="lg:col-span-2">
            <RecentPaymentsList payments={recent} />
          </div>
          {holdings && <HeyPayWalletAside holdings={snapshot} />}
        </div>
      </div>
    );
  }

  const qrSvg = holdings
    ? await QRCode.toString(holdings.publicKey, { type: "svg", margin: 1 })
    : "";

  return (
    <div className="flex flex-col gap-stack-lg">
      {header}

      {holdings && faucet.enabled && !faucet.claimed && <FaucetCard amountXlm={faucet.amountXlm} />}

      {connected && <FreighterStrip address={connected} holdings={ownSnapshot} />}
      {own && !connected && (
        <Link
          href="/payer/settings"
          className="inline-flex items-center gap-stack-sm self-start rounded text-body-md text-primary underline-offset-2 hover:underline focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          <Icon name="account_balance_wallet" />
          Pay from your own wallet: connect Freighter
        </Link>
      )}

      <div className="grid grid-cols-1 gap-stack-lg lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/* With Freighter connected, say which wallet this total is. */}
          <HeroBalanceCard holdings={snapshot} label={connected ? "HeyPay wallet" : undefined} />
        </div>
        <ScanQrphCard />

        <div className="lg:col-span-2">
          <RecentPaymentsList payments={recent} />
        </div>
        {holdings && <PrefundPanel publicKey={holdings.publicKey} qrSvg={qrSvg} />}
      </div>
    </div>
  );
}
