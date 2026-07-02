// src/app/api/payments/[id]/cancel/route.ts
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { applyTransition } from "@/server/payments/state-machine";
import { notFound, forbidden, conflict } from "@/lib/errors";

// Cancellable only before XLM is submitted on-chain.
const CANCELLABLE = new Set(["CREATED", "QUOTED", "AUTHORIZED"]);

export const POST = route(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  const payment = await db.payment.findUnique({
    where: { id: ctx.params.id! },
    include: { payer: { include: { wallet: true } } },
  });
  if (!payment) throw notFound("payment not found");
  if (payment.payerId !== user.id) throw forbidden("not your payment");
  if (!CANCELLABLE.has(payment.status))
    throw conflict(`cannot cancel payment in status ${payment.status}`);

  const updated = await db.$transaction(async (tx) => {
    if (payment.status === "AUTHORIZED" && payment.payer.wallet) {
      // Release the reservation held at confirm.
      const total = dec(payment.amountXlm.toString()).plus(payment.networkFeeXlm.toString());
      const w = await tx.custodialWallet.findUniqueOrThrow({
        where: { id: payment.payer.wallet.id },
      });
      const next = dec(w.reservedXlm.toString()).minus(total);
      await tx.custodialWallet.update({
        where: { id: w.id },
        data: { reservedXlm: (next.isNegative() ? dec("0") : next).toFixed(7) },
      });
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: { failureReason: "cancelled by payer" },
    });
    return applyTransition(tx, payment, "FAILED", { reason: "cancelled by payer" });
  });
  return json({ status: updated.status });
});
