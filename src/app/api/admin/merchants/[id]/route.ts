import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { MerchantStatus } from "@/generated/prisma/client";
import { setMerchantStatus } from "@/server/admin/merchants";

const bodySchema = z.object({ status: z.nativeEnum(MerchantStatus) });

export const PATCH = route(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireRole("ADMIN");
  const { status } = await parseBody(req, bodySchema);
  const id = ctx.params.id;
  if (!id) throw new Error("Missing id");
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const merchant = await setMerchantStatus({ id, status, actorId: admin.id, ip });
  return json({ ...merchant, createdAt: merchant.createdAt.toISOString() });
});
