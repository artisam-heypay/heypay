// src/app/api/wallet/swap/quote/route.ts
//
// What an amount of XLM or USDC swaps into right now, and the least the payer
// would receive. Reads the DEX only; nothing is held or moved.
import { z } from "zod";
import { route, json, parseQuery } from "@/lib/http";
import { dec } from "@/lib/money";
import { swapAmountSchema, swapAssetSchema, type SwapQuoteResponse } from "@/lib/swap";
import { requireRole } from "@/server/auth/sessions";
import { rateLimit } from "@/server/auth/rate-limit";
import { quoteSwap } from "@/server/payer/swap";

const querySchema = z.object({ from: swapAssetSchema, amount: swapAmountSchema });

export const GET = route(async (req) => {
  const user = await requireRole("PAYER");
  await rateLimit(`swap-quote:user:${user.id}`, { limit: 60, windowSec: 60 });
  const { from, amount } = parseQuery(req, querySchema);

  const quote = await quoteSwap(from, dec(amount));
  const body: SwapQuoteResponse = {
    from: quote.from,
    to: quote.to,
    mode: quote.mode,
    amount: quote.amount.toFixed(7),
    estimated: quote.estimated.toFixed(7),
    minReceived: quote.minReceived.toFixed(7),
  };
  return json(body);
});
