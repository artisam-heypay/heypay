// src/app/api/payments/[id]/cancel/route.ts
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { isIssuedAsset } from "@/lib/assets";
import { releaseAsset } from "@/server/wallet/balances";
import { applyTransition } from "@/server/payments/state-machine";
import { notFound, forbidden, conflict } from "@/lib/errors";

// Cancellable only before the crypto is submitted on-chain.
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
  // A deposit the payer signed with their own wallet was handed to the network
  // as it was accepted: from then on the crypto may already be in the escrow.
  if (payment.externalPublicKey)
    throw conflict("This payment's deposit has already been sent, so it can't be cancelled.");

  const updated = await db.$transaction(async (tx) => {
    if (payment.status === "AUTHORIZED" && payment.payer.wallet) {
      // Release the reservations held at confirm: the asset leg, plus — for an
      // issued asset — the separate XLM network-fee hold.
      const walletId = payment.payer.wallet.id;
      const amountAsset = dec(payment.amountAsset.toString());
      const networkFeeXlm = dec(payment.networkFeeXlm.toString());
      if (isIssuedAsset(payment.asset)) {
        await releaseAsset(tx, walletId, payment.asset, amountAsset);
        await releaseAsset(tx, walletId, "XLM", networkFeeXlm);
      } else {
        await releaseAsset(tx, walletId, payment.asset, amountAsset.plus(networkFeeXlm));
      }
    }
    // Called off, not failed: kept out of the failures admins look into.
    return applyTransition(tx, payment, "CANCELLED", { reason: "cancelled by payer" });
  });
  return json({ status: updated.status });
});
