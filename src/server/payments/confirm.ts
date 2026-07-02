// src/server/payments/confirm.ts
import "server-only";
import { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { dec, availableXlm } from "@/lib/money";
import { conflict, forbidden, notFound } from "@/lib/errors";
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
    const total = dec(payment.amountXlm.toString()).plus(payment.networkFeeXlm.toString());

    const updated = await db.$transaction(async (tx) => {
      const w = await tx.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const available = availableXlm(
        dec(w.cachedXlmBalance.toString()),
        dec(w.reservedXlm.toString()),
      );
      if (available.lessThan(total)) throw conflict("insufficient available XLM balance");
      await tx.custodialWallet.update({
        where: { id: w.id },
        data: { reservedXlm: dec(w.reservedXlm.toString()).plus(total).toFixed(7) },
      });
      return applyTransition(tx, payment, "AUTHORIZED", { reservedXlm: total.toFixed(7) });
    });

    await enqueueSettle(payment.id);
    return { paymentId: updated.id, status: updated.status };
  });
}
