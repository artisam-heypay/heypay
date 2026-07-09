import { route, json } from "@/lib/http";
import { assertSameOrigin } from "@/server/auth/csrf";
import { requireRole } from "@/server/auth/sessions";
import { audit } from "@/server/auth/audit";
import { badRequest } from "@/lib/errors";
import { prisma } from "@/server/db";
import { decodeQrph } from "@/server/qrph/decode";
import {
  serializeMerchant,
  merchantSetupState,
  getMerchantForUser,
} from "@/server/merchant/service";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("MERCHANT");
  const existing = await getMerchantForUser(user.id);

  const setup = merchantSetupState(existing);
  if (!setup.hasBusiness) throw badRequest("Business name is required");
  if (!setup.hasSettlement) throw badRequest("A settlement bank account is required");
  if (!setup.hasQrph) throw badRequest("A linked QRPH is required");

  // Re-validate the stored QRPH CRC at go-live (defense in depth).
  let crcValid = false;
  try {
    crcValid = decodeQrph(existing.qrphRaw).crcValid;
  } catch {
    crcValid = false;
  }
  if (!crcValid) throw badRequest("Stored QRPH failed CRC validation — please re-link it");

  const reviewGate = Boolean(process.env.MERCHANT_REVIEW_GATE);
  const merchant = await prisma.merchant.update({
    where: { id: existing.id },
    data: { status: reviewGate ? "PENDING_REVIEW" : "ACTIVE" },
  });
  await audit({
    actorId: user.id,
    action: "merchant.go-live",
    target: merchant.id,
    metadata: { status: merchant.status },
  });
  return json({ merchant: serializeMerchant(merchant) });
});
