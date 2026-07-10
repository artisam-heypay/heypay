import QRCode from "qrcode";
import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { getWalletSummary } from "@/server/payer/data";
import { getAssetRate } from "@/server/payments/rate";
import { assetIssuer } from "@/server/stellar/assets";
import { walletService } from "@/server/stellar/wallet";
import { PrefundView, type PrefundAsset } from "@/components/payer/PrefundView";

export default async function PayerPrefundPage() {
  const user = await requireRole(Role.PAYER);
  const wallet = await getWalletSummary(user.id);
  const balances = wallet?.balances ?? [];

  // Whether the wallet can receive an issued asset is decided by the chain, not
  // our cache: if the configured issuer ever changes, the cached flag refers to
  // a trustline for the *old* issuer, and showing the deposit address on its
  // say-so invites an op_no_trust rejection. Ask Horizon; fall back to the cache
  // only if Horizon is unreachable.
  const issued = balances.filter((b) => isIssuedAsset(b.asset)).map((b) => b.asset);
  const onChain: Partial<Record<PaymentAsset, boolean>> = {};
  if (wallet && issued.length > 0) {
    try {
      for (const b of await walletService.getBalances(wallet.publicKey, issued)) {
        onChain[b.asset] = b.trustline;
      }
    } catch {
      // Horizon down — cached flags are the best remaining answer.
    }
  }

  const assets: PrefundAsset[] = await Promise.all(
    balances.map(async (b) => {
      const rate = await getAssetRate(b.asset);
      return {
        asset: b.asset,
        balance: b.cached.toFixed(7),
        // No rate (rail can't price this asset) → show no PHP line at all,
        // rather than an authoritative-looking ₱0.00 next to a real balance.
        approxPhp: rate ? b.cached.times(rate).toFixed(2) : null,
        trustlineRequired: isIssuedAsset(b.asset),
        canReceive: isIssuedAsset(b.asset) ? (onChain[b.asset] ?? b.canReceive) : true,
        issuer: assetIssuer(b.asset),
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
