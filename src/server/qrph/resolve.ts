import "server-only";
import { Merchant, MerchantStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { QrphDecoded } from "./decode";

export function resolveMerchant(decoded: QrphDecoded): Promise<Merchant | null> {
  const or: Prisma.MerchantWhereInput[] = [{ qrphRaw: decoded.raw }];
  if (decoded.merchantId) or.push({ qrphMerchantId: decoded.merchantId });
  return db.merchant.findFirst({
    where: { status: MerchantStatus.ACTIVE, OR: or },
  });
}
