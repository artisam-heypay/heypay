import QRCode from "qrcode";
import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { dec } from "@/lib/money";
import { getWalletSummary, getRecentPayments } from "@/server/payer/data";
import { getXlmPhpRate } from "@/server/payments/rate";
import { HeroBalanceCard } from "@/components/payer/HeroBalanceCard";
import { ScanQrphCard } from "@/components/payer/ScanQrphCard";
import { RecentPaymentsList } from "@/components/payer/RecentPaymentsList";
import { PrefundPanel } from "@/components/payer/PrefundPanel";
import { NetworkStatus } from "@/components/payer/NetworkStatus";

export default async function PayerDashboardPage() {
  const user = await requireRole(Role.PAYER);
  const [wallet, recent] = await Promise.all([
    getWalletSummary(user.id),
    getRecentPayments(user.id, 5),
  ]);

  const availableXlm = wallet?.availableXlm ?? dec("0");
  const rate = await getXlmPhpRate();
  const approxPhp = rate ? availableXlm.times(rate) : dec("0");

  const qrSvg = wallet ? await QRCode.toString(wallet.publicKey, { type: "svg", margin: 1 }) : "";

  return (
    <div className="flex flex-col gap-stack-lg">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Dashboard</h1>
        <NetworkStatus />
      </div>

      <div className="grid grid-cols-1 gap-stack-lg lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HeroBalanceCard availableXlm={availableXlm} approxPhp={approxPhp} />
        </div>
        <ScanQrphCard />

        <div className="lg:col-span-2">
          <RecentPaymentsList payments={recent} />
        </div>
        {wallet && <PrefundPanel publicKey={wallet.publicKey} qrSvg={qrSvg} />}
      </div>
    </div>
  );
}
