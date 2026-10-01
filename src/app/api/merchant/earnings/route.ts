import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import {
  getMerchantEarnings,
  getMerchantForUser,
  parseEarningsRange,
} from "@/server/merchant/service";

export const GET = route(async (req) => {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  const range = parseEarningsRange(new URL(req.url).searchParams.get("range"));
  return json(await getMerchantEarnings(merchant.id, range));
});
