import "server-only";
import { prisma } from "@/server/db";
import { Role } from "@/generated/prisma/client";
import { audit } from "@/server/auth/audit";
import { notFound } from "@/lib/errors";
import { encodeCursor, decodeCursor, type Page } from "./pagination";

export type AdminUserRow = {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
};

const SELECT = { id: true, username: true, role: true, isActive: true, createdAt: true } as const;

export async function listUsers(input: {
  cursor?: string;
  limit: number;
  q?: string;
}): Promise<Page<AdminUserRow>> {
  const where = input.q ? { username: { contains: input.q, mode: "insensitive" as const } } : {};
  const cur = input.cursor ? decodeCursor(input.cursor) : null;
  const rows = await prisma.user.findMany({
    where: cur
      ? {
          AND: [
            where,
            {
              OR: [
                { createdAt: { lt: cur.createdAt } },
                { createdAt: cur.createdAt, id: { lt: cur.id } },
              ],
            },
          ],
        }
      : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: SELECT,
  });
  const items = rows.slice(0, input.limit);
  const nextCursor = rows.length > input.limit ? encodeCursor(items[items.length - 1]!) : null;
  return { items, nextCursor };
}

export async function setUserActive(input: {
  id: string;
  isActive: boolean;
  actorId: string;
  ip?: string;
}): Promise<AdminUserRow> {
  const existing = await prisma.user.findUnique({ where: { id: input.id }, select: { id: true } });
  if (!existing) throw notFound("User not found");
  const user = await prisma.user.update({
    where: { id: input.id },
    data: { isActive: input.isActive },
    select: SELECT,
  });
  await audit({
    actorId: input.actorId,
    action: input.isActive ? "admin.user.activate" : "admin.user.deactivate",
    target: input.id,
    metadata: { isActive: input.isActive },
    ip: input.ip,
  });
  return user;
}
