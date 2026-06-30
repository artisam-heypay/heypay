import { route, json, parseBody } from "@/lib/http";
import { assertSameOrigin } from "@/server/auth/csrf";
import { requireRole } from "@/server/auth/sessions";
import { audit } from "@/server/auth/audit";
import { conflict } from "@/lib/errors";
import { prisma } from "@/server/db";
import { createMerchantSchema } from "@/lib/schemas/merchant";
import { serializeMerchant, getMerchantForUserOrNull } from "@/server/merchant/service";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("MERCHANT");
  const { businessName } = await parseBody(req, createMerchantSchema);

  if (await getMerchantForUserOrNull(user.id)) {
    throw conflict("Merchant profile already exists");
  }

  const merchant = await prisma.merchant.create({
    data: {
      userId: user.id,
      businessName,
      status: "DRAFT",
      qrphRaw: "",
      settlementBankCode: "",
      settlementBankName: "",
      accountName: "",
      accountNumber: "",
      accountNumberLast4: "",
    },
  });
  await audit({ actorId: user.id, action: "merchant.create", target: merchant.id });
  return json({ merchant: serializeMerchant(merchant) }, 201);
});
