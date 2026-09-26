import "server-only";
import { Merchant, MerchantStatus } from "@/generated/prisma/client";
import { conflict } from "@/lib/errors";
import { db } from "@/server/db";
import type { QrphDecoded } from "./decode";

const AMBIGUOUS =
  "This QR code is linked to more than one HeyPay merchant, so the payment can't be routed " +
  "safely. The merchant needs to contact HeyPay support.";

/**
 * The single ACTIVE merchant a scanned code belongs to, or null when none does.
 *
 * The exact code wins; otherwise the QR's merchant id is tried. Either way, a
 * match on more than one merchant is refused rather than guessed: picking one
 * would pay a merchant who is not the one the payer is standing in front of.
 */
export async function resolveMerchant(decoded: QrphDecoded): Promise<Merchant | null> {
  const exact = await db.merchant.findMany({
    where: { status: MerchantStatus.ACTIVE, qrphRaw: decoded.raw },
    take: 2,
  });
  if (exact.length > 1) throw conflict(AMBIGUOUS, { match: "qrphRaw" });
  if (exact.length === 1) return exact[0]!;

  if (!decoded.merchantId) return null;
  const byId = await db.merchant.findMany({
    where: { status: MerchantStatus.ACTIVE, qrphMerchantId: decoded.merchantId },
    take: 2,
  });
  if (byId.length > 1) throw conflict(AMBIGUOUS, { match: "qrphMerchantId" });
  return byId[0] ?? null;
}
