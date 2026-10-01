// src/server/payments/confirm.ts
import "server-only";
import { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { isIssuedAsset } from "@/lib/assets";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { getAssetBalance, reserveAsset } from "@/server/wallet/balances";
import { withIdempotencyKey } from "./idempotency";
import { applyTransition } from "./state-machine";
import { enqueueSettle } from "@/server/queue/queues";

export type ConfirmPaymentInput = { paymentId: string; payerId: string; idemKey: string };
export type ConfirmPaymentResult = { paymentId: string; status: PaymentStatus };

export async function confirmPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentResult> {
  return withIdempotencyKey(input.idemKey, "payment.confirm", async () => {
    const payment = await db.payment.findUnique({
      where: { id: input.paymentId },
      include: { payer: { include: { wallet: true } } },
    });
    if (!payment) throw notFound("payment not found");
    if (payment.payerId !== input.payerId) throw forbidden("not your payment");

    // Already authorised (e.g. a retried request with a fresh key) → return current state.
    if (payment.status === "AUTHORIZED") return { paymentId: payment.id, status: payment.status };
    if (payment.status !== "QUOTED")
      throw conflict(`cannot confirm payment in status ${payment.status}`);
    if (!payment.quoteExpiresAt || payment.quoteExpiresAt.getTime() < Date.now()) {
      throw conflict("quote expired; please re-quote");
    }

    const wallet = payment.payer.wallet;
    if (!wallet) throw conflict("payer wallet not found");

    const asset = payment.asset;
    const amountAsset = dec(payment.amountAsset.toString());
    const networkFeeXlm = dec(payment.networkFeeXlm.toString());
    // For XLM both legs are the same balance, so reserve them as one amount; for
    // an issued asset the fee is a separate XLM hold.
    const assetHold = isIssuedAsset(asset) ? amountAsset : amountAsset.plus(networkFeeXlm);

    const updated = await db.$transaction(async (tx) => {
      const balance = await getAssetBalance(tx, wallet.id, asset);
      if (balance.available.lessThan(assetHold))
        throw conflict(`insufficient available ${asset} balance`);
      await reserveAsset(tx, wallet.id, asset, assetHold);

      if (isIssuedAsset(asset)) {
        const xlm = await getAssetBalance(tx, wallet.id, "XLM");
        if (xlm.available.lessThan(networkFeeXlm))
          throw conflict("insufficient XLM to cover the Stellar network fee");
        await reserveAsset(tx, wallet.id, "XLM", networkFeeXlm);
      }

      return applyTransition(tx, payment, "AUTHORIZED", {
        asset,
        reservedAsset: assetHold.toFixed(7),
        reservedXlmFee: isIssuedAsset(asset) ? networkFeeXlm.toFixed(7) : undefined,
      });
    });

    await enqueueSettle(payment.id);
    return { paymentId: updated.id, status: updated.status };
  });
}
