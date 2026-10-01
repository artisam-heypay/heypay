// src/app/api/qrph/decode/route.ts
import { z } from "zod";
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { decodeQrph, decodeQrphImage, type QrphDecoded } from "@/server/qrph/decode";
import { resolveMerchant } from "@/server/qrph/resolve";
import { badRequest } from "@/lib/errors";
import { captureUserEvent } from "@/server/observability/analytics";

const rawSchema = z.object({ raw: z.string().min(1) });

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("PAYER");

  const contentType = req.headers.get("content-type") ?? "";
  const source = contentType.includes("multipart/form-data") ? "image" : "camera";
  let decoded: QrphDecoded;

  try {
    decoded = await decodeRequest(req, contentType);
  } catch (err) {
    captureUserEvent("qr_scan_failed", user, {
      source,
      error: (err as Error).message.slice(0, 200),
    });
    throw err;
  }

  const merchant = await resolveMerchant(decoded);
  // merchant_found=false means a valid QRPH that is not a HeyPay merchant.
  captureUserEvent("qr_scanned", user, {
    source,
    crc_valid: decoded.crcValid,
    merchant_found: Boolean(merchant),
    merchant_id: merchant?.id ?? null,
    has_amount: decoded.amountPhp != null,
  });
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

async function decodeRequest(req: Request, contentType: string): Promise<QrphDecoded> {
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const image = form.get("image");
    if (!(image instanceof File)) throw badRequest("image file is required");
    const buffer = Buffer.from(await image.arrayBuffer());
    return decodeQrphImage(buffer);
  }
  const parsed = rawSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest("provide `raw` (string) or an `image` upload");
  return decodeQrph(parsed.data.raw);
}
