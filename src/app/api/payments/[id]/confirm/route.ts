// src/app/api/payments/[id]/confirm/route.ts
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { confirmPayment } from "@/server/payments/confirm";
import { badRequest } from "@/lib/errors";

export const POST = route(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  await rateLimit(`confirm:user:${user.id}`, { limit: 20, windowSec: 60 });
  const idemKey = req.headers.get("idempotency-key");
  if (!idemKey) throw badRequest("Idempotency-Key header is required");
  const res = await confirmPayment({ paymentId: ctx.params.id!, payerId: user.id, idemKey });
  return json(res);
});
