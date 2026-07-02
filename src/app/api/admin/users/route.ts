import { route, json, parseQuery } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { listQuerySchema } from "@/server/admin/pagination";
import { listUsers } from "@/server/admin/users";

export const GET = route(async (req) => {
  await requireRole("ADMIN");
  const q = parseQuery(req, listQuerySchema);
  const page = await listUsers({ cursor: q.cursor, limit: q.limit, q: q.q });
  return json({
    items: page.items.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
    nextCursor: page.nextCursor,
  });
});
