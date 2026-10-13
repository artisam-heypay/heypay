// src/app/api/payments/[id]/signed/route.ts
import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { acceptSignedDeposit } from "@/server/payments/signed";
import { nonCustodialEnabled } from "@/server/wallet/external";

// A signed escrow deposit is a few hundred bytes; far beyond that is not one.
const signedSchema = z.object({ xdr: z.string().trim().min(1).max(16_384) });

// Takes the escrow deposit a payer signed with their own wallet, checks it is
// the deposit for this payment and nothing else, and hands it to the network.
// Not there at all while NONCUSTODIAL_ENABLED is off.
export const POST = route(async (req, ctx) => {
  if (!nonCustodialEnabled()) throw notFound();
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  await rateLimit(`signed:user:${user.id}`, { limit: 20, windowSec: 60 });
  const { xdr } = await parseBody(req, signedSchema);
  return json(await acceptSignedDeposit({ paymentId: ctx.params.id!, payerId: user.id, xdr }));
});
