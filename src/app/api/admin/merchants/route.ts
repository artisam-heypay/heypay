import { route, json, parseQuery } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { MerchantStatus } from "@/generated/prisma/client";
import { listQuerySchema } from "@/server/admin/pagination";
import { listAdminMerchants } from "@/server/admin/merchants";

export const GET = route(async (req) => {
  await requireRole("ADMIN");
  const q = parseQuery(req, listQuerySchema);
  const status = q.status && q.status in MerchantStatus ? (q.status as MerchantStatus) : undefined;
  const page = await listAdminMerchants({ cursor: q.cursor, limit: q.limit, q: q.q, status });
  return json({
    items: page.items.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    nextCursor: page.nextCursor,
  });
});
