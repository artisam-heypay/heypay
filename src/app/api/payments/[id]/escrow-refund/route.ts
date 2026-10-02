// src/app/api/payments/[id]/escrow-refund/route.ts
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { selfRefundEscrow } from "@/server/payments/escrow-self-refund";
import { stellarTxUrl } from "@/lib/stellar-explorer";

// The payer takes a payment back from the escrow once its deadline has passed.
export const POST = route(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const { refundTxHash } = await selfRefundEscrow({ id: ctx.params.id!, payerId: user.id, ip });
  return json({ refundTxHash, refundTxUrl: stellarTxUrl(refundTxHash) });
});
