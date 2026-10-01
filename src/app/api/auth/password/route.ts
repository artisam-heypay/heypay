import { z } from "zod";
import { NextResponse } from "next/server";
import { route, parseBody } from "@/lib/http";
import { unauthorized } from "@/lib/errors";
import { db } from "@/server/db";
import { clientIp } from "@/lib/net";
import { requireUser, createSession } from "@/server/auth/sessions";
import { verifyPassword, hashPassword } from "@/server/auth/password";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { audit } from "@/server/auth/audit";

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const sessionUser = await requireUser(); // re-auth: must be logged in
  const ip = clientIp(req);
  await rateLimit(`password:user:${sessionUser.id}`, { limit: 5, windowSec: 900 });

  const { currentPassword, newPassword } = await parseBody(req, passwordSchema);

  const user = await db.user.findUnique({ where: { id: sessionUser.id } });
  if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
    throw unauthorized("Current password is incorrect");
  }

  const passwordHash = await hashPassword(newPassword);
  await db.user.update({ where: { id: user.id }, data: { passwordHash } });

  // Privilege change → rotate sessions: revoke all, then issue a fresh one for this device.
  await db.session.deleteMany({ where: { userId: user.id } });
  await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
  await audit({ actorId: user.id, action: "auth.password.change", target: user.id, ip });

  return new NextResponse(null, { status: 204 });
});
