import QRCode from "qrcode";
import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { getRecentPayments } from "@/server/payer/data";
import { getHoldings, getOwnWalletHoldings, holdingsSnapshot } from "@/server/payer/holdings";
import { getFaucetStatus } from "@/server/payer/faucet";
import { getOwnWallet, nonCustodialEnabled, ownWalletAccount } from "@/server/wallet/external";
import { HeroBalanceCard } from "@/components/payer/HeroBalanceCard";
import { ScanQrphCard } from "@/components/payer/ScanQrphCard";
import { RecentPaymentsList } from "@/components/payer/RecentPaymentsList";
import { PrefundPanel } from "@/components/payer/PrefundPanel";
import { NetworkStatus } from "@/components/payer/NetworkStatus";
import { FaucetCard } from "@/components/payer/FaucetCard";
import { WalletsPanel } from "@/components/payer/WalletsPanel";

export default async function PayerDashboardPage() {
  const user = await requireRole(Role.PAYER);
  // The payer's own wallet, offered while NONCUSTODIAL_ENABLED is on.
  const own = nonCustodialEnabled() ? await getOwnWallet(user.id) : null;
  const connected = own?.externalPublicKey ?? null;
  // Their payments come from it only while they chose it.
  const paysWithOwn = Boolean(own && ownWalletAccount(own));

  const [holdings, recent, faucet, ownHoldings] = await Promise.all([
    getHoldings(user.id),
    getRecentPayments(user.id, 5),
    getFaucetStatus(user.id),
    // Read from Stellar; null when it cannot be read, so it is never shown as empty.
    connected ? getOwnWalletHoldings(connected).catch(() => null) : null,
  ]);

  const snapshot = holdingsSnapshot(holdings);
  // The faucet and the deposit address fund the HeyPay wallet, so they are only
  // offered while payments come from it.
  const fundsHeyPay = Boolean(holdings) && !paysWithOwn;
  const qrSvg =
    holdings && fundsHeyPay
      ? await QRCode.toString(holdings.publicKey, { type: "svg", margin: 1 })
      : "";

  return (
    <div className="flex flex-col gap-stack-lg">
      <div className="flex items-center justify-between gap-stack-sm">
        <h1 className="min-w-0 font-display text-headline-lg-mobile lg:text-headline-lg">
          Dashboard
        </h1>
        <NetworkStatus />
      </div>

      {fundsHeyPay && faucet.enabled && !faucet.claimed && (
        <FaucetCard amountXlm={faucet.amountXlm} />
      )}

      <div className="grid grid-cols-1 gap-stack-lg lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {own ? (
            <WalletsPanel
              paysWithOwn={paysWithOwn}
              heypay={snapshot}
              own={
                connected
                  ? {
                      address: connected,
                      holdings: ownHoldings ? holdingsSnapshot(ownHoldings) : null,
                    }
                  : null
              }
              canSwap={snapshot.tokens.some((t) => t.asset === "USDC")}
            />
          ) : (
            <HeroBalanceCard holdings={snapshot} />
          )}
        </div>
        <ScanQrphCard />

        <div className={fundsHeyPay ? "min-w-0 lg:col-span-2" : "min-w-0 lg:col-span-3"}>
          <RecentPaymentsList payments={recent} />
        </div>
        {holdings && fundsHeyPay && <PrefundPanel publicKey={holdings.publicKey} qrSvg={qrSvg} />}
      </div>
    </div>
  );
}
