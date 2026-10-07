// src/app/api/wallet/swap/route.ts
//
// Swaps XLM for USDC, or USDC for XLM, inside the payer's own wallet. The body
// carries the two numbers the payer confirmed: the most to spend and the least
// to receive.
import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { dec } from "@/lib/money";
import { stellarTxUrl } from "@/lib/stellar-explorer";
import { swapAmountSchema, swapAssetSchema, type SwapResponse } from "@/lib/swap";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { captureUserEvent } from "@/server/observability/analytics";
import { executeSwap } from "@/server/payer/swap";

const bodySchema = z.object({
  from: swapAssetSchema,
  amount: swapAmountSchema,
  minReceived: swapAmountSchema,
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  await rateLimit(`swap:user:${user.id}`, { limit: 10, windowSec: 60 });
  const { from, amount, minReceived } = await parseBody(req, bodySchema);

  const swap = await executeSwap({
    userId: user.id,
    from,
    amount: dec(amount),
    minReceived: dec(minReceived),
  });
  captureUserEvent("wallet_swapped", user, {
    from_asset: swap.from,
    to_asset: swap.to,
    sent: swap.sent.toNumber(),
    received: swap.received.toNumber(),
    stellar_tx_hash: swap.txHash,
  });

  const body: SwapResponse = {
    txHash: swap.txHash,
    txUrl: stellarTxUrl(swap.txHash),
    from: swap.from,
    to: swap.to,
    sent: swap.sent.toFixed(7),
    received: swap.received.toFixed(7),
  };
  return json(body);
});
