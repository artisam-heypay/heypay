import "server-only";
import { dec, phpToXlm, availableXlm, Decimal } from "@/lib/money";
import { db } from "@/server/db";
import { rail } from "@/server/rails";
import { withRetry } from "@/lib/retry";
import { conflict, notFound } from "@/lib/errors";
import { newPaymentReference } from "./reference";

// One Stellar payment operation costs the base fee of 100 stroops = 0.0000100 XLM.
export const STELLAR_BASE_FEE_XLM: Decimal = dec("0.0000100");

export type CreateQuoteInput = { payerId: string; merchantId: string; amountPhp: Decimal };
export type CreateQuoteResult = {
  paymentId: string;
  reference: string;
  amountPhp: Decimal;
  rate: Decimal;
  amountXlm: Decimal;
  networkFeeXlm: Decimal;
  quoteExpiresAt: Date;
};

export async function createQuote(input: CreateQuoteInput): Promise<CreateQuoteResult> {
  const merchant = await db.merchant.findUnique({ where: { id: input.merchantId } });
  if (!merchant || merchant.status !== "ACTIVE")
    throw notFound("merchant not available for payment");

  const wallet = await db.custodialWallet.findUnique({ where: { userId: input.payerId } });
  if (!wallet) throw conflict("payer wallet not found");

  const quote = await withRetry(() =>
    rail.getQuote({ sell: "XLM", buy: "PHP", phpAmount: input.amountPhp }),
  );
  const rate = quote.rate;
  const amountXlm = phpToXlm(input.amountPhp, rate); // ROUND_UP, 7dp (payer covers)
  const networkFeeXlm = STELLAR_BASE_FEE_XLM;
  const requiredXlm = amountXlm.plus(networkFeeXlm);

  const available = availableXlm(
    dec(wallet.cachedXlmBalance.toString()),
    dec(wallet.reservedXlm.toString()),
  );
  if (available.lessThan(requiredXlm)) {
    throw conflict("insufficient available XLM balance", {
      availableXlm: available.toFixed(7),
      requiredXlm: requiredXlm.toFixed(7),
    });
  }

  const payment = await db.$transaction(async (tx) => {
    await tx.exchangeRateSnapshot.create({
      data: { pair: "XLMPHP", rate: rate.toFixed(8), source: "PDAX" },
    });
    const p = await tx.payment.create({
      data: {
        reference: newPaymentReference(),
        payerId: input.payerId,
        merchantId: input.merchantId,
        asset: "XLM",
        amountPhp: input.amountPhp.toFixed(2),
        quotedRate: rate.toFixed(8),
        amountXlm: amountXlm.toFixed(7),
        networkFeeXlm: networkFeeXlm.toFixed(7),
        status: "QUOTED",
        quoteExpiresAt: quote.expiresAt,
      },
    });
    await tx.paymentEvent.create({
      data: {
        paymentId: p.id,
        fromStatus: "CREATED",
        toStatus: "QUOTED",
        detail: { rate: rate.toFixed(8) },
      },
    });
    return p;
  });

  return {
    paymentId: payment.id,
    reference: payment.reference,
    amountPhp: input.amountPhp,
    rate,
    amountXlm,
    networkFeeXlm,
    quoteExpiresAt: quote.expiresAt,
  };
}
