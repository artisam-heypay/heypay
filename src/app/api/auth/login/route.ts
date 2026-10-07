import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { unauthorized, tooManyRequests } from "@/lib/errors";
import { redis } from "@/server/redis";
import { clientIp } from "@/lib/net";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/server/auth/password";
import { findUserByLogin, normalizeEmail } from "@/server/auth/accounts";
import { createSession } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { audit } from "@/server/auth/audit";
import { captureUserEvent } from "@/server/observability/analytics";

// `username` also takes the account's email: accounts made by email or Google
// sign-up are known by their address, older and scripted ones by username.
const loginSchema = z.object({
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

const MAX_FAILS = 5;
const LOCK_SEC = 900; // 15 min backoff

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const ip = clientIp(req);
  await rateLimit(`login:ip:${ip}`, { limit: 20, windowSec: 900 });

  const body = await parseBody(req, loginSchema);
  const { password } = body;
  // One spelling per account, so the lockout cannot be dodged by changing case.
  const username = body.username.includes("@") ? normalizeEmail(body.username) : body.username;

  const lockKey = `lockout:${username}`;
  if (await redis.get(lockKey)) {
    throw tooManyRequests("Account temporarily locked. Try again later.");
  }

  const user = await findUserByLogin(username);
  // Always run a verify (against a dummy hash for unknown users, and for
  // Google-only accounts, which have no password) to equalize timing.
  const ok =
    !!user?.passwordHash && user.isActive && (await verifyPassword(user.passwordHash, password));
  if (!user?.passwordHash) await verifyPassword(DUMMY_PASSWORD_HASH, password);

  if (!ok) {
    const failKey = `fails:${username}`;
    const fails = await redis.incr(failKey);
    await redis.expire(failKey, LOCK_SEC);
    if (fails >= MAX_FAILS) {
      await redis.set(lockKey, "1", "EX", LOCK_SEC);
    }
    await audit({ actorId: user?.id ?? null, action: "auth.login.failed", target: username, ip });
    if (user)
      captureUserEvent("user_login_failed", user, {
        active: user.isActive,
        locked: fails >= MAX_FAILS,
      });
    throw unauthorized("Invalid email, username or password");
  }

  await redis.del(`fails:${username}`);
  await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
  await audit({ actorId: user.id, action: "auth.login", target: user.id, ip });
  captureUserEvent("user_logged_in", user);

  return json({ user: { id: user.id, username: user.username, role: user.role } });
});
