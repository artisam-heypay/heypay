import { route, json, parseBody } from "@/lib/http";
import { assertSameOrigin } from "@/server/auth/csrf";
import { requireRole } from "@/server/auth/sessions";
import { audit } from "@/server/auth/audit";
import { prisma } from "@/server/db";
import { patchMerchantSchema } from "@/lib/schemas/merchant";
import {
  serializeMerchant,
  merchantSetupState,
  getMerchantForUser,
} from "@/server/merchant/service";

export const GET = route(async () => {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  return json({ merchant: serializeMerchant(merchant), setup: merchantSetupState(merchant) });
});

export const PATCH = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("MERCHANT");
  const existing = await getMerchantForUser(user.id);
  const patch = await parseBody(req, patchMerchantSchema);

  const merchant = await prisma.merchant.update({
    where: { id: existing.id },
    data: {
      ...(patch.businessName !== undefined ? { businessName: patch.businessName } : {}),
      ...(patch.logoKey !== undefined ? { logoKey: patch.logoKey } : {}),
    },
  });
  await audit({ actorId: user.id, action: "merchant.update", target: merchant.id });
  return json({ merchant: serializeMerchant(merchant), setup: merchantSetupState(merchant) });
});
