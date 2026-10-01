import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { notFound } from "@/lib/errors";
import { getAdminPayment } from "@/server/admin/payments";

export const GET = route(async (_req, ctx) => {
  await requireRole("ADMIN");
  const id = ctx.params.id;
  if (!id) throw new Error("Missing id");
  const p = await getAdminPayment(id);
  if (!p) throw notFound("Payment not found");
  return json({
    ...p,
    amountPhp: p.amountPhp.toFixed(2),
    amountAsset: p.amountAsset.toFixed(7),
    createdAt: p.createdAt.toISOString(),
    events: p.events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
  });
});
