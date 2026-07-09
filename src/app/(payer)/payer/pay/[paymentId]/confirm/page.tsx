import { notFound, forbidden } from "@/lib/errors";
import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { getWalletSummary } from "@/server/payer/data";
import { getXlmPhpRate } from "@/server/payments/rate";
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
  const availableXlm = wallet?.availableXlm ?? dec("0");

  const rate = await getXlmPhpRate();
  const approxPhp = rate ? availableXlm.times(rate) : dec("0");

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
        amountPhp={payment.amountPhp.toFixed(2)}
        quotedRate={payment.quotedRate.toFixed(8)}
        amountXlm={payment.amountXlm.toFixed(7)}
        networkFeeXlm={payment.networkFeeXlm.toFixed(7)}
        quoteExpiresAt={payment.quoteExpiresAt?.toISOString() ?? null}
        merchantName={payment.merchant.businessName}
        walletPublicKey={wallet?.publicKey ?? ""}
        availableXlm={availableXlm.toFixed(7)}
        approxPhp={approxPhp.toFixed(2)}
      />
    </div>
  );
}
