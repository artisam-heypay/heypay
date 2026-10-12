// src/app/api/payments/[id]/prepare/route.ts
import { route, json } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { prepareEscrowDeposit } from "@/server/payments/prepare";
import { nonCustodialEnabled } from "@/server/wallet/external";

// Tells a payer who signs with their own wallet what the escrow deposit for a
// quoted payment must be; their browser builds it and their wallet signs it.
// Not there at all while NONCUSTODIAL_ENABLED is off.
export const POST = route(async (req, ctx) => {
  if (!nonCustodialEnabled()) throw notFound();
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  await rateLimit(`prepare:user:${user.id}`, { limit: 20, windowSec: 60 });
  return json(await prepareEscrowDeposit({ paymentId: ctx.params.id!, payerId: user.id }));
});
