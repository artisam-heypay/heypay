import { route, json, parseQuery } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { txQuerySchema } from "@/lib/schemas/merchant";
import { listMerchantTransactions, getMerchantForUser } from "@/server/merchant/service";

export const GET = route(async (req) => {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  const q = parseQuery(req, txQuerySchema);
  return json(await listMerchantTransactions(merchant.id, q));
});
