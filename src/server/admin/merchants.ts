import "server-only";
import { prisma } from "@/server/db";
import { MerchantStatus } from "@/generated/prisma/client";
import { audit } from "@/server/auth/audit";
import { notFound } from "@/lib/errors";
import { encodeCursor, decodeCursor, type Page } from "./pagination";

export type AdminMerchantRow = {
  id: string;
  businessName: string;
  status: MerchantStatus;
  username: string;
  accountNumberLast4: string;
  settlementBankName: string;
  createdAt: Date;
};

function toRow(m: {
  id: string;
  businessName: string;
  status: MerchantStatus;
  accountNumberLast4: string;
  settlementBankName: string;
  createdAt: Date;
  user: { username: string };
}): AdminMerchantRow {
  return {
    id: m.id,
    businessName: m.businessName,
    status: m.status,
    username: m.user.username,
    accountNumberLast4: m.accountNumberLast4,
    settlementBankName: m.settlementBankName,
    createdAt: m.createdAt,
  };
}

const INCLUDE = { user: { select: { username: true } } } as const;

export async function listAdminMerchants(input: {
  cursor?: string;
  limit: number;
  q?: string;
  status?: MerchantStatus;
}): Promise<Page<AdminMerchantRow>> {
  const filters: Record<string, unknown>[] = [];
  if (input.q) filters.push({ businessName: { contains: input.q, mode: "insensitive" } });
  if (input.status) filters.push({ status: input.status });
  const cur = input.cursor ? decodeCursor(input.cursor) : null;
  if (cur)
    filters.push({
      OR: [{ createdAt: { lt: cur.createdAt } }, { createdAt: cur.createdAt, id: { lt: cur.id } }],
    });
  const rows = await prisma.merchant.findMany({
    where: filters.length ? { AND: filters } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    include: INCLUDE,
  });
  const sliced = rows.slice(0, input.limit);
  const items = sliced.map(toRow);
  const nextCursor = rows.length > input.limit ? encodeCursor(sliced[sliced.length - 1]!) : null;
  return { items, nextCursor };
}

export async function setMerchantStatus(input: {
  id: string;
  status: MerchantStatus;
  actorId: string;
  ip?: string;
}): Promise<AdminMerchantRow> {
  const existing = await prisma.merchant.findUnique({
    where: { id: input.id },
    select: { id: true },
  });
  if (!existing) throw notFound("Merchant not found");
  const merchant = await prisma.merchant.update({
    where: { id: input.id },
    data: { status: input.status },
    include: INCLUDE,
  });
  await audit({
    actorId: input.actorId,
    action: "admin.merchant.status",
    target: input.id,
    metadata: { status: input.status },
    ip: input.ip,
  });
  return toRow(merchant);
}
