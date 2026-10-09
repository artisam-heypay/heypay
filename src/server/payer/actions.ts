"use server";
import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { getPayerPayments, type PayerPaymentListItem } from "./data";
import { getPayerSwaps, type PayerSwapListItem } from "./swap";

export async function loadMorePayerPayments(
  cursor: string,
): Promise<{ items: PayerPaymentListItem[]; nextCursor?: string }> {
  const user = await requireRole(Role.PAYER);
  return getPayerPayments(user.id, { cursor, limit: 20 });
}

export async function loadMorePayerSwaps(
  cursor: string,
): Promise<{ items: PayerSwapListItem[]; nextCursor?: string }> {
  const user = await requireRole(Role.PAYER);
  return getPayerSwaps(user.id, { cursor, limit: 20 });
}
