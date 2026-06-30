import { route, json, parseBody } from "@/lib/http";
import { assertSameOrigin } from "@/server/auth/csrf";
import { requireRole } from "@/server/auth/sessions";
import { audit } from "@/server/auth/audit";
import { badRequest } from "@/lib/errors";
import { prisma } from "@/server/db";
import { encryptSecret } from "@/server/crypto/envelope";
import { settlementSchema } from "@/lib/schemas/merchant";
import { getBankName } from "@/server/merchant/banks";
import { serializeMerchant, getMerchantForUser } from "@/server/merchant/service";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("MERCHANT");
  const existing = await getMerchantForUser(user.id);
  const { bankCode, accountName, accountNumber } = await parseBody(req, settlementSchema);

  const bankName = getBankName(bankCode);
  if (!bankName) throw badRequest("Unsupported bank code");

  const merchant = await prisma.merchant.update({
    where: { id: existing.id },
    data: {
      settlementBankCode: bankCode,
      settlementBankName: bankName,
      accountName,
      accountNumber: encryptSecret(accountNumber),
      accountNumberLast4: accountNumber.slice(-4),
    },
  });
  await audit({ actorId: user.id, action: "merchant.settlement.set", target: merchant.id });
  return json({ merchant: serializeMerchant(merchant) });
});
