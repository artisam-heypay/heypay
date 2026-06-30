import "server-only";
import QRCode from "qrcode";
import { Role } from "@/generated/prisma";
import { requireRole } from "@/server/auth/sessions";
import { getWalletSummary, getRecentPayments } from "@/server/payer/data";
import { HeroBalanceCard } from "@/components/payer/HeroBalanceCard";
import { ScanQrphCard } from "@/components/payer/ScanQrphCard";
import { RecentPaymentsList } from "@/components/payer/RecentPaymentsList";
import { PrefundPanel } from "@/components/payer/PrefundPanel";
import { NetworkStatus } from "@/components/payer/NetworkStatus";

export default async function DashboardPage() {
  const user = await requireRole(Role.PAYER);
  const [summary, recent] = await Promise.all([
    getWalletSummary(user.id),
    getRecentPayments(user.id, 5),
  ]);
  const publicKey = summary?.publicKey ?? "";
  const qrSvg = publicKey ? await QRCode.toString(publicKey, { type: "svg", margin: 1 }) : "";

  return (
    <div className="flex flex-col gap-stack-lg">
      <NetworkStatus />
      <div className="grid grid-cols-1 gap-stack-lg lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HeroBalanceCard
            availableXlm={summary?.availableXlm.toFixed(7) ?? "0.0000000"}
            approxPhp={summary?.approxPhp.toFixed(2) ?? "0.00"}
          />
        </div>
        <ScanQrphCard />
        <div className="lg:col-span-2">
          <RecentPaymentsList items={recent} />
        </div>
        <PrefundPanel publicKey={publicKey} qrSvg={qrSvg} />
      </div>
    </div>
  );
}
