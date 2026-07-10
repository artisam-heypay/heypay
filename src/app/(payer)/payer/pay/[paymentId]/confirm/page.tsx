import { notFound, forbidden } from "@/lib/errors";
import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { getWalletSummary } from "@/server/payer/data";
import { getAssetRate } from "@/server/payments/rate";
import { rail } from "@/server/rails";
import { ConfirmPayment } from "@/components/payer/ConfirmPayment";

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
  if (!payment) throw notFound("payment not found");
  if (payment.payerId !== user.id) throw forbidden("not your payment");

  const wallet = await getWalletSummary(user.id);
  const balances = wallet?.balances ?? [];
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
        quoteExpiresAt={payment.quoteExpiresAt?.toISOString() ?? null}
        merchantName={payment.merchant.businessName}
        walletPublicKey={wallet?.publicKey ?? ""}
        availableAsset={available.toFixed(7)}
        approxPhp={approxPhp.toFixed(2)}
      />
    </div>
  );
}
