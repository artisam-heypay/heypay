"use server";
import { Role } from "@/generated/prisma";
import { requireRole } from "@/server/auth/sessions";
import { getPayerPayments, type PayerPaymentListItem } from "@/server/payer/data";

export async function loadMorePayerPayments(
  cursor: string,
): Promise<{ items: PayerPaymentListItem[]; nextCursor?: string }> {
  const user = await requireRole(Role.PAYER);
  return getPayerPayments(user.id, { cursor, limit: 20 });
}
