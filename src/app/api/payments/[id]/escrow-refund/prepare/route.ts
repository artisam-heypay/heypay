// src/app/api/payments/[id]/escrow-refund/prepare/route.ts
import { route, json } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { prepareOwnWalletRefund } from "@/server/payments/escrow-self-refund";
import { nonCustodialEnabled } from "@/server/wallet/external";

// Tells a payer who paid from their own wallet what the refund after the escrow
// deadline must be; their browser builds it and their wallet signs it.
// Not there at all while NONCUSTODIAL_ENABLED is off.
export const POST = route(async (req, ctx) => {
  if (!nonCustodialEnabled()) throw notFound();
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  await rateLimit(`escrow-refund-prepare:user:${user.id}`, { limit: 20, windowSec: 60 });
  return json(await prepareOwnWalletRefund({ id: ctx.params.id!, payerId: user.id }));
});
