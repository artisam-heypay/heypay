import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { refundPayment } from "@/server/admin/payments";

export const POST = route(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireRole("ADMIN");
  const id = ctx.params.id;
  if (!id) throw new Error("Missing id");
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const result = await refundPayment({ id, actorId: admin.id, ip });
  return json(result);
});
