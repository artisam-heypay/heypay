import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { getMerchantEarnings, getMerchantForUser } from "@/server/merchant/service";

export const GET = route(async () => {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  return json(await getMerchantEarnings(merchant.id));
});
