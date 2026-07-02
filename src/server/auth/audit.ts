import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

export async function audit(input: {
  actorId?: string | null;
  action: string;
  target?: string;
  metadata?: unknown;
  ip?: string;
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        target: input.target ?? null,
        metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
        ip: input.ip ?? null,
      },
    });
  } catch {
    // Best-effort: audit failures must never break the request. Log the action name only
    // (never the metadata, which may contain sensitive context).
    console.error("[audit] failed to write audit log", { action: input.action });
  }
}
