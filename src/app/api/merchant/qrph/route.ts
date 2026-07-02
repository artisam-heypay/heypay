import { route, json, parseBody } from "@/lib/http";
import { assertSameOrigin } from "@/server/auth/csrf";
import { requireRole } from "@/server/auth/sessions";
import { audit } from "@/server/auth/audit";
import { badRequest, conflict } from "@/lib/errors";
import { prisma } from "@/server/db";
import { decodeQrph } from "@/server/qrph/decode";
import { verifyUploadedObject } from "@/server/storage/s3";
import { qrphSchema } from "@/lib/schemas/merchant";
import { serializeMerchant, getMerchantForUser } from "@/server/merchant/service";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("MERCHANT");
  const existing = await getMerchantForUser(user.id);
  const { raw, imageKey } = await parseBody(req, qrphSchema);

  const decoded = decodeQrph(raw); // throws badRequest on malformed TLV
  if (!decoded.crcValid) throw badRequest("QRPH CRC validation failed");
  if (decoded.currency && decoded.currency !== "608")
    throw badRequest("Only PHP (608) QRPH is supported");

  // Uniqueness: no other merchant may already own this code.
  const dupe = await prisma.merchant.findFirst({
    where: { qrphRaw: raw, NOT: { id: existing.id } },
    select: { id: true },
  });
  if (dupe) throw conflict("This QRPH is already registered to another HeyPay merchant");

  if (imageKey) await verifyUploadedObject(imageKey); // magic-byte + size check

  const merchant = await prisma.merchant.update({
    where: { id: existing.id },
    data: {
      qrphRaw: raw,
      qrphMerchantName: decoded.merchantName ?? null,
      qrphMerchantCity: decoded.merchantCity ?? null,
      qrphMerchantId: decoded.merchantId ?? null,
      qrphAcquirerId: decoded.acquirerId ?? null,
      qrphCountry: decoded.country ?? "PH",
      qrphCurrency: decoded.currency ?? "608",
      ...(imageKey ? { qrphImageKey: imageKey } : {}),
    },
  });
  await audit({ actorId: user.id, action: "merchant.qrph.set", target: merchant.id });
  return json({ merchant: serializeMerchant(merchant), decoded });
});
