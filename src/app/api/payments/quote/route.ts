// src/app/api/payments/quote/route.ts
import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { dec } from "@/lib/money";
import { createQuote } from "@/server/payments/quote";

const bodySchema = z.object({
  merchantId: z.string().min(1),
  amountPhp: z
    .union([z.string(), z.number()])
    .transform((v) => dec(v))
    .refine((d) => d.greaterThan(0), "amount must be > 0"),
  // Optional; defaults to XLM. USDC/USDT are gated by PAYMENT_ASSETS (SPEC §1/§4).
  asset: z.enum(["XLM", "USDC", "USDT"]).optional(),
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  await rateLimit(`quote:user:${user.id}`, { limit: 30, windowSec: 60 });
  const { merchantId, amountPhp, asset } = await parseBody(req, bodySchema);

  const q = await createQuote({ payerId: user.id, merchantId, amountPhp, asset });
  return json({
    paymentId: q.paymentId,
    reference: q.reference,
    amountPhp: q.amountPhp.toFixed(2),
    rate: q.rate.toFixed(8),
    amountXlm: q.amountXlm.toFixed(7),
    networkFeeXlm: q.networkFeeXlm.toFixed(7),
    quoteExpiresAt: q.quoteExpiresAt.toISOString(),
  });
});
