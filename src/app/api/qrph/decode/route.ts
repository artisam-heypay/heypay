// src/app/api/qrph/decode/route.ts
import { z } from "zod";
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { decodeQrph, decodeQrphImage, type QrphDecoded } from "@/server/qrph/decode";
import { resolveMerchant } from "@/server/qrph/resolve";
import { badRequest } from "@/lib/errors";

const rawSchema = z.object({ raw: z.string().min(1) });

export const POST = route(async (req) => {
  assertSameOrigin(req);
  await requireRole("PAYER");

  const contentType = req.headers.get("content-type") ?? "";
  let decoded: QrphDecoded;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const image = form.get("image");
    if (!(image instanceof File)) throw badRequest("image file is required");
    const buffer = Buffer.from(await image.arrayBuffer());
    decoded = await decodeQrphImage(buffer);
  } else {
    const parsed = rawSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw badRequest("provide `raw` (string) or an `image` upload");
    decoded = decodeQrph(parsed.data.raw);
  }

  const merchant = await resolveMerchant(decoded);
  return json({
    decoded,
    merchant: merchant
      ? {
          id: merchant.id,
          businessName: merchant.businessName,
          qrphMerchantName: merchant.qrphMerchantName,
          amountPhp: decoded.amountPhp ?? null,
        }
      : null,
  });
});
