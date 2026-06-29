import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { unauthorized, tooManyRequests } from "@/lib/errors";
import { db } from "@/server/db";
import { redis } from "@/server/redis";
import { clientIp } from "@/lib/net";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/server/auth/password";
import { createSession } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { audit } from "@/server/auth/audit";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

const MAX_FAILS = 5;
const LOCK_SEC = 900; // 15 min backoff

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const ip = clientIp(req);
  await rateLimit(`login:ip:${ip}`, { limit: 20, windowSec: 900 });

  const { username, password } = await parseBody(req, loginSchema);

  const lockKey = `lockout:${username}`;
  if (await redis.get(lockKey)) {
    throw tooManyRequests("Account temporarily locked. Try again later.");
  }

  const user = await db.user.findUnique({ where: { username } });
  // Always run a verify (against a dummy hash for unknown users) to equalize timing.
  const ok = !!user && user.isActive && (await verifyPassword(user.passwordHash, password));
  if (!user) await verifyPassword(DUMMY_PASSWORD_HASH, password);

  if (!ok) {
    const failKey = `fails:${username}`;
    const fails = await redis.incr(failKey);
    await redis.expire(failKey, LOCK_SEC);
    if (fails >= MAX_FAILS) {
      await redis.set(lockKey, "1", "EX", LOCK_SEC);
    }
    await audit({ actorId: user?.id ?? null, action: "auth.login.failed", target: username, ip });
    throw unauthorized("Invalid username or password");
  }

  await redis.del(`fails:${username}`);
  await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
  await audit({ actorId: user.id, action: "auth.login", target: user.id, ip });

  return json({ user: { id: user.id, username: user.username, role: user.role } });
});
