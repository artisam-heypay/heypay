import { route, json, parseQuery } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { PaymentStatus } from "@/generated/prisma/client";
import { listQuerySchema } from "@/server/admin/pagination";
import { listAdminPayments } from "@/server/admin/payments";

export const GET = route(async (req) => {
  await requireRole("ADMIN");
  const q = parseQuery(req, listQuerySchema);
  const status = q.status && q.status in PaymentStatus ? (q.status as PaymentStatus) : undefined;
  const page = await listAdminPayments({ cursor: q.cursor, limit: q.limit, status, q: q.q });
  return json({
    items: page.items.map((p) => ({
      ...p,
      amountPhp: p.amountPhp.toFixed(2),
      amountXlm: p.amountXlm.toFixed(7),
      createdAt: p.createdAt.toISOString(),
    })),
    nextCursor: page.nextCursor,
  });
});
