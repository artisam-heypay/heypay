// src/app/api/payments/quote/route.ts
import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { dec } from "@/lib/money";
import { createQuote } from "@/server/payments/quote";
import { captureUserEvent } from "@/server/observability/analytics";

const bodySchema = z.object({
  merchantId: z.string().min(1),
  amountPhp: z
    .union([z.string(), z.number()])
    .transform((v) => dec(v))
    .refine((d) => d.greaterThan(0), "amount must be > 0"),
  // Optional; defaults to XLM. USDC/USDT are gated by PAYMENT_ASSETS (SPEC §1/§4).
  asset: z.enum(["XLM", "USDC", "USDT"]).optional(),
});

const ZERO_XLM = "0.0000000";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  await rateLimit(`quote:user:${user.id}`, { limit: 30, windowSec: 60 });
  const { merchantId, amountPhp, asset } = await parseBody(req, bodySchema);

  let q: Awaited<ReturnType<typeof createQuote>>;
  try {
    q = await createQuote({ payerId: user.id, merchantId, amountPhp, asset });
  } catch (err) {
    // Refused quotes (low balance, disabled asset, rate unavailable) are the
    // first place a payer drops out, so they are tracked with the reason.
    captureUserEvent("payment_quote_failed", user, {
      merchant_id: merchantId,
      asset: asset ?? "XLM",
      amount_php: amountPhp.toNumber(),
      error: (err as Error).message.slice(0, 200),
    });
    throw err;
  }
  captureUserEvent("payment_quoted", user, {
    payment_id: q.paymentId,
    merchant_id: merchantId,
    asset: q.asset,
    settlement_asset: q.settlementAsset ?? null,
    amount_php: q.amountPhp.toNumber(),
  });
  return json({
    paymentId: q.paymentId,
    reference: q.reference,
    asset: q.asset,
    // The asset the rail receives; differs when the payment converts on the DEX.
    settlementAsset: q.settlementAsset,
    amountPhp: q.amountPhp.toFixed(2),
    rate: q.rate.toFixed(8),
    amountAsset: q.amountAsset.toFixed(7),
    // Legacy field: the XLM debited, which is zero when funding with another asset.
    amountXlm: q.asset === "XLM" ? q.amountAsset.toFixed(7) : ZERO_XLM,
    networkFeeXlm: q.networkFeeXlm.toFixed(7),
    quoteExpiresAt: q.quoteExpiresAt.toISOString(),
  });
});
