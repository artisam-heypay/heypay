import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { setUserActive } from "@/server/admin/users";

const bodySchema = z.object({ isActive: z.boolean() });

export const PATCH = route(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireRole("ADMIN");
  const { isActive } = await parseBody(req, bodySchema);
  const id = ctx.params.id;
  if (!id) throw new Error("Missing id");
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const user = await setUserActive({ id, isActive, actorId: admin.id, ip });
  return json({ ...user, createdAt: user.createdAt.toISOString() });
});
