import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/server/db";
import { unauthorized, forbidden } from "@/lib/errors";
import type { Role } from "@/generated/prisma/client";

export type SessionUser = { id: string; username: string; role: Role; isActive: boolean };

export const SESSION_COOKIE = "heypay_session" as const;

const TTL_SEC = 60 * 60 * 24 * 7; // 7 days
const TTL_MS = TTL_SEC * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

function toSessionUser(u: {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
}): SessionUser {
  return { id: u.id, username: u.username, role: u.role, isActive: u.isActive };
}

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<void> {
  const token = randomBytes(32).toString("base64url"); // 256 bits of entropy
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TTL_MS);

  await db.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, { ...baseCookieOptions(), maxAge: TTL_SEC });
}

// Raw-token lookup used by proxy.ts (which reads NextRequest cookies, not next/headers).
export async function lookupSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  if (!session.user.isActive) return null;
  return toSessionUser(session.user);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  if (!session.user.isActive) return null;

  // Sliding renewal: when less than half the TTL remains, extend it.
  if (session.expiresAt.getTime() - Date.now() < TTL_MS / 2) {
    const expiresAt = new Date(Date.now() + TTL_MS);
    await db.session.update({ where: { id: session.id }, data: { expiresAt } });
    try {
      store.set(SESSION_COOKIE, token, { ...baseCookieOptions(), maxAge: TTL_SEC });
    } catch {
      // cookies() is read-only inside a Server Component render — safe to ignore.
    }
  }

  return toSessionUser(session.user);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthorized();
  return user;
}

export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== role) throw forbidden();
  return user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  try {
    store.delete(SESSION_COOKIE);
  } catch {
    // ignore in read-only contexts
  }
}
