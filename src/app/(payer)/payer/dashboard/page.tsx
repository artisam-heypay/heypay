import QRCode from "qrcode";
import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { getRecentPayments } from "@/server/payer/data";
import { getHoldings } from "@/server/payer/holdings";
import { HeroBalanceCard } from "@/components/payer/HeroBalanceCard";
import type { HoldingsSnapshot } from "@/components/payer/HoldingsLive";
import { ScanQrphCard } from "@/components/payer/ScanQrphCard";
import { RecentPaymentsList } from "@/components/payer/RecentPaymentsList";
import { PrefundPanel } from "@/components/payer/PrefundPanel";
import { NetworkStatus } from "@/components/payer/NetworkStatus";

export default async function PayerDashboardPage() {
  const user = await requireRole(Role.PAYER);
  const [holdings, recent] = await Promise.all([
    getHoldings(user.id),
    getRecentPayments(user.id, 5),
  ]);

  const snapshot: HoldingsSnapshot = {
    totalPhp: holdings?.totalPhp.toFixed(2) ?? "0.00",
    hasUnpricedBalance: holdings?.hasUnpricedBalance ?? false,
    tokens: (holdings?.tokens ?? []).map((t) => ({
      asset: t.asset,
      balance: t.balance.toFixed(7),
      valuePhp: t.valuePhp?.toFixed(2) ?? null,
    })),
  };

  const qrSvg = holdings
    ? await QRCode.toString(holdings.publicKey, { type: "svg", margin: 1 })
    : "";

  return (
    <div className="flex flex-col gap-stack-lg">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Dashboard</h1>
        <NetworkStatus />
      </div>

      <div className="grid grid-cols-1 gap-stack-lg lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HeroBalanceCard holdings={snapshot} />
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
