// src/app/api/payments/[id]/route.ts
import { route, json } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { notFound, forbidden } from "@/lib/errors";
import { stellarTxUrl } from "@/lib/stellar-explorer";
import { escrowSelfRefundState } from "@/server/payments/escrow-self-refund";

export const GET = route(async (req, ctx) => {
  const user = await requireUser();
  const payment = await db.payment.findUnique({
    where: { id: ctx.params.id! },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      merchant: { select: { businessName: true } },
    },
  });
  if (!payment) throw notFound("payment not found");
  if (payment.payerId !== user.id && user.role !== "ADMIN") throw forbidden("not your payment");
  // Only the payer can take a payment back from the escrow. Reading the escrow
  // asks the Soroban RPC, so it is done on request (the detail drawer), not on
  // every status poll.
  const escrowRefund =
    req.nextUrl.searchParams.get("escrow") === "1" && payment.payerId === user.id
      ? await escrowSelfRefundState(payment)
      : null;

  return json({
    payment: {
      id: payment.id,
      reference: payment.reference,
      status: payment.status,
      amountPhp: payment.amountPhp.toFixed(2),
      quotedRate: payment.quotedRate.toFixed(8),
      asset: payment.asset,
      amountAsset: payment.amountAsset.toFixed(7),
      networkFeeXlm: payment.networkFeeXlm.toFixed(7),
      netSettledPhp: payment.netSettledPhp?.toFixed(2) ?? null,
      merchantName: payment.merchant.businessName,
      stellarTxHash: payment.stellarTxHash,
      stellarTxUrl: payment.stellarTxHash ? stellarTxUrl(payment.stellarTxHash) : null,
      refundTxHash: payment.refundTxHash,
      refundTxUrl: payment.refundTxHash ? stellarTxUrl(payment.refundTxHash) : null,
      escrowRefund,
      failureReason: payment.failureReason,
      quoteExpiresAt: payment.quoteExpiresAt?.toISOString() ?? null,
      settledAt: payment.settledAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
    },
    events: payment.events.map((e) => ({
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      detail: e.detail,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});
