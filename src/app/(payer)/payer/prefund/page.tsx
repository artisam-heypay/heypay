import QRCode from "qrcode";
import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { dec } from "@/lib/money";
import { isIssuedAsset } from "@/lib/assets";
import { MoneyAmount } from "@/components/ui";
import { getWalletSummary } from "@/server/payer/data";
import { getAssetRate } from "@/server/payments/rate";
import { DepositCard, type DepositAsset } from "@/components/payer/DepositCard";
import { PendingDepositWatcher } from "@/components/payer/PendingDepositWatcher";

export default async function PayerPrefundPage() {
  const user = await requireRole(Role.PAYER);
  const wallet = await getWalletSummary(user.id);
  const balances = wallet?.balances ?? [];

  const rows = await Promise.all(
    balances.map(async (b) => {
      const rate = await getAssetRate(b.asset);
      return { ...b, approxPhp: rate ? b.cached.times(rate) : dec("0") };
    }),
  );

  const depositAssets: DepositAsset[] = balances.map((b) => ({
    asset: b.asset,
    trustlineRequired: isIssuedAsset(b.asset),
    canReceive: b.canReceive,
  }));

  const qrSvg = wallet ? await QRCode.toString(wallet.publicKey, { type: "svg", margin: 1 }) : "";

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-stack-lg">
      <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Prefund Account</h1>
      <div className="flex flex-col gap-stack-md">
        <p className="text-label-md uppercase text-on-surface-variant">Current Balance</p>
        {rows.map((b) => (
          <MoneyAmount
            key={b.asset}
            xlm={b.cached}
            asset={b.asset}
            php={b.approxPhp}
            size={b.asset === "XLM" ? "display" : "md"}
          />
        ))}
      </div>
      <PendingDepositWatcher initialBalance={(wallet?.balanceXlm ?? dec("0")).toFixed(7)} />
      {wallet && <DepositCard publicKey={wallet.publicKey} qrSvg={qrSvg} assets={depositAssets} />}
    </div>
  );
}
