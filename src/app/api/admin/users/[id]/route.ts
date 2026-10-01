import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { setUserActive } from "@/server/admin/users";
import { captureUserEvent } from "@/server/observability/analytics";

const bodySchema = z.object({ isActive: z.boolean() });

export const PATCH = route(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireRole("ADMIN");
  const { isActive } = await parseBody(req, bodySchema);
  const id = ctx.params.id;
  if (!id) throw new Error("Missing id");
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const user = await setUserActive({ id, isActive, actorId: admin.id, ip });
  captureUserEvent("admin_user_status_changed", admin, {
    target_user_id: id,
    target_role: user.role,
    is_active: isActive,
  });
  return json({ ...user, createdAt: user.createdAt.toISOString() });
});
