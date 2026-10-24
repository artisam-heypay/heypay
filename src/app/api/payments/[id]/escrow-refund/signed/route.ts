// src/app/api/payments/[id]/escrow-refund/signed/route.ts
import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { acceptSignedRefund } from "@/server/payments/escrow-self-refund";
import { nonCustodialEnabled } from "@/server/wallet/external";
import { stellarTxUrl } from "@/lib/stellar-explorer";

// A signed escrow refund is a few hundred bytes; far beyond that is not one.
const signedSchema = z.object({ xdr: z.string().trim().min(1).max(16_384) });

// Takes the refund a payer signed with their own wallet once the escrow's
// deadline has passed, checks it is the refund for this payment and nothing
// else, and hands it to the network.
// Not there at all while NONCUSTODIAL_ENABLED is off.
export const POST = route(async (req, ctx) => {
  if (!nonCustodialEnabled()) throw notFound();
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  await rateLimit(`escrow-refund-signed:user:${user.id}`, { limit: 20, windowSec: 60 });
  const { xdr } = await parseBody(req, signedSchema);
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const refund = await acceptSignedRefund({ id: ctx.params.id!, payerId: user.id, xdr, ip });
  return json({ ...refund, refundTxUrl: stellarTxUrl(refund.refundTxHash) });
});
