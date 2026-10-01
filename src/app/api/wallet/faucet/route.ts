// src/app/api/wallet/faucet/route.ts
//
// Testnet faucet: sends the signed-in payer their one-time test XLM. Off on
// mainnet and whenever no faucet account is configured (404).
import { route, json } from "@/lib/http";
import { clientIp } from "@/lib/net";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { claimFaucet } from "@/server/payer/faucet";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  await rateLimit(`faucet:user:${user.id}`, { limit: 3, windowSec: 60 });
  await rateLimit(`faucet:ip:${clientIp(req)}`, { limit: 10, windowSec: 3600 });
  return json(await claimFaucet(user, clientIp(req)));
});
