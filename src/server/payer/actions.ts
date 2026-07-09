"use server";
import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { getPayerPayments, type PayerPaymentListItem } from "./data";

export async function loadMorePayerPayments(
  cursor: string,
): Promise<{ items: PayerPaymentListItem[]; nextCursor?: string }> {
  const user = await requireRole(Role.PAYER);
  return getPayerPayments(user.id, { cursor, limit: 20 });
}
