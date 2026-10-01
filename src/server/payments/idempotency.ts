// src/server/payments/idempotency.ts
import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { badRequest, conflict } from "@/lib/errors";

const DEFAULT_TTL_SEC = 60 * 60 * 24; // 24h

export async function withIdempotencyKey<T>(
  key: string | null | undefined,
  scope: string,
  fn: () => Promise<T>,
  opts?: { ttlSec?: number },
): Promise<T> {
  if (!key) throw badRequest("Idempotency-Key is required");
  const storedKey = `${scope}:${key}`;
  const expiresAt = new Date(Date.now() + (opts?.ttlSec ?? DEFAULT_TTL_SEC) * 1000);

  // Atomically claim the key. A unique-constraint violation means it already exists.
  try {
    await db.idempotencyKey.create({ data: { key: storedKey, scope, expiresAt } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await db.idempotencyKey.findUnique({ where: { key: storedKey } });
      if (existing?.response != null) return existing.response as T;
      // Row exists but no response yet → another call is in flight.
      throw conflict("A request with this Idempotency-Key is already in progress");
    }
    throw err;
  }

  const result = await fn();
  await db.idempotencyKey.update({
    where: { key: storedKey },
    data: { response: result as unknown as Prisma.InputJsonValue },
  });
  return result;
}
