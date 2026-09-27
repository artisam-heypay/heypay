import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { retryPayment } from "@/server/admin/payments";
import { captureUserEvent } from "@/server/observability/analytics";

export const POST = route(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireRole("ADMIN");
  const id = ctx.params.id;
  if (!id) throw new Error("Missing id");
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const result = await retryPayment({ id, actorId: admin.id, ip });
  captureUserEvent("admin_payment_retried", admin, { payment_id: id, from_status: result.status });
  return json(result);
});
