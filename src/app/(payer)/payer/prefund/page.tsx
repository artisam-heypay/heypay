import QRCode from "qrcode";
import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { isIssuedAsset } from "@/lib/assets";
import { getWalletSummary } from "@/server/payer/data";
import { getAssetRate } from "@/server/payments/rate";
import { PrefundView, type PrefundAsset } from "@/components/payer/PrefundView";

export default async function PayerPrefundPage() {
  const user = await requireRole(Role.PAYER);
  const wallet = await getWalletSummary(user.id);

  const assets: PrefundAsset[] = await Promise.all(
    (wallet?.balances ?? []).map(async (b) => {
      const rate = await getAssetRate(b.asset);
      return {
        asset: b.asset,
        balance: b.cached.toFixed(7),
        // No rate (rail can't price this asset) → show no PHP line at all,
        // rather than an authoritative-looking ₱0.00 next to a real balance.
        approxPhp: rate ? b.cached.times(rate).toFixed(2) : null,
        trustlineRequired: isIssuedAsset(b.asset),
        canReceive: b.canReceive,
      };
    }),
  );

  const qrSvg = wallet ? await QRCode.toString(wallet.publicKey, { type: "svg", margin: 1 }) : "";

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-stack-lg">
      <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Prefund Account</h1>
      {wallet && <PrefundView publicKey={wallet.publicKey} qrSvg={qrSvg} assets={assets} />}
    </div>
  );
}
