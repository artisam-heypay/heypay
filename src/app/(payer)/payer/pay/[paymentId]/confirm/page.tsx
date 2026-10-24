import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { enabledAssets } from "@/lib/assets";
import { getWalletSummary } from "@/server/payer/data";
import { getAssetRate } from "@/server/payments/rate";
import { rail } from "@/server/rails";
import { isAssetConfigured } from "@/server/stellar/assets";
import { escrowAppliesTo, escrowFeeEstimateXlm } from "@/server/stellar/escrow-config";
import { getNetworkPassphrase, isMainnet } from "@/server/stellar/horizon";
import { walletService } from "@/server/stellar/wallet";
import { getOwnWallet, nonCustodialEnabled, ownWalletAccount } from "@/server/wallet/external";
import { ConfirmPayment } from "@/components/payer/ConfirmPayment";

/**
 * What the payer's own account holds, read from the chain: HeyPay keeps no
 * balance for it. An issued asset it has no line to cannot be paid with.
 */
async function ownWalletBalances(account: string) {
  const assets = enabledAssets().filter(isAssetConfigured);
  const onChain = await walletService.getBalances(account, assets);
  return onChain.map((b) => ({ asset: b.asset, available: b.balance, canReceive: b.trustline }));
}

export default async function ConfirmPaymentPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = await params;
  const user = await requireRole(Role.PAYER);

  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { merchant: { select: { businessName: true, qrphMerchantCity: true } } },
  });
  // A page has no API wrapper to turn an AppError into a status, so a thrown one
  // renders the 500 error page. Someone else's payment reads as missing too, so
  // the page does not confirm which ids exist.
  if (!payment || payment.payerId !== user.id) notFound();

  // A payer who chose their own wallet pays from that account and signs the
  // payment in Freighter; everyone else pays from the HeyPay wallet.
  const own = nonCustodialEnabled() ? ownWalletAccount(await getOwnWallet(user.id)) : null;
  const wallet = await getWalletSummary(user.id);
  const balances = own ? await ownWalletBalances(own) : (wallet?.balances ?? []);
  const funding = balances.find((b) => b.asset === payment.asset);
  const available = funding?.available ?? dec("0");

  const rate = await getAssetRate(payment.asset);
  const approxPhp = rate ? available.times(rate) : dec("0");

  // Switching funding asset re-quotes, so only offer assets this rail can settle.
  const assetOptions = balances
    .filter((b) => rail.supportsAsset(b.asset))
    .map((b) => ({
      asset: b.asset,
      available: b.available.toFixed(7),
      canReceive: b.canReceive,
    }));

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-stack-lg">
      <div>
        <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">
          Confirm Payment
        </h1>
        <p className="mt-stack-sm font-display text-headline-md">{payment.merchant.businessName}</p>
        {payment.merchant.qrphMerchantCity && (
          <p className="text-body-sm text-on-surface-variant">
            {payment.merchant.qrphMerchantCity}
          </p>
        )}
      </div>

      <ConfirmPayment
        paymentId={payment.id}
        merchantId={payment.merchantId}
        asset={payment.asset}
        assetOptions={assetOptions}
        amountPhp={payment.amountPhp.toFixed(2)}
        quotedRate={payment.quotedRate.toFixed(8)}
        amountAsset={payment.amountAsset.toFixed(7)}
        networkFeeXlm={payment.networkFeeXlm.toFixed(7)}
        escrowFeeXlm={escrowAppliesTo(payment.asset) ? escrowFeeEstimateXlm().toFixed(7) : null}
        quoteExpiresAt={payment.quoteExpiresAt?.toISOString() ?? null}
        merchantName={payment.merchant.businessName}
        walletPublicKey={own ?? wallet?.publicKey ?? ""}
        ownWallet={
          own
            ? {
                address: own,
                networkPassphrase: getNetworkPassphrase(),
                networkName: isMainnet() ? "Mainnet" : "Testnet",
              }
            : null
        }
        availableAsset={available.toFixed(7)}
        approxPhp={approxPhp.toFixed(2)}
      />
    </div>
  );
}
