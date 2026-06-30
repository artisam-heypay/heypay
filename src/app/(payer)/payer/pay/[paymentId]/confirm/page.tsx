import "server-only";
import { notFound } from "next/navigation";
import { Role } from "@/generated/prisma";
import { requireRole } from "@/server/auth/sessions";
import { getConfirmContext } from "@/server/payer/data";
import { ConfirmPayment } from "@/components/payer/ConfirmPayment";

export default async function ConfirmPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const user = await requireRole(Role.PAYER);
  const ctx = await getConfirmContext(paymentId, user.id);
  if (!ctx) notFound();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-stack-lg">
      <div>
        <h1 className="text-headline-lg font-display font-bold">Confirm Payment</h1>
        <p className="text-headline-md font-display text-primary">{ctx.merchant.businessName}</p>
        {ctx.merchant.city ? (
          <p className="text-body-sm text-on-surface-variant">{ctx.merchant.city}</p>
        ) : null}
      </div>
      <ConfirmPayment
        paymentId={ctx.payment.id}
        amountPhp={ctx.payment.amountPhp}
        quotedRate={ctx.payment.quotedRate}
        amountXlm={ctx.payment.amountXlm}
        networkFeeXlm={ctx.payment.networkFeeXlm}
        quoteExpiresAt={ctx.payment.quoteExpiresAt}
        merchantName={ctx.merchant.businessName}
        wallet={ctx.wallet}
      />
    </div>
  );
}
