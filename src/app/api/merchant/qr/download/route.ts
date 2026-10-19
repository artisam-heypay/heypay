import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireRole } from "@/server/auth/sessions";
import { getMerchantForUser } from "@/server/merchant/service";
import { qrFileName, qrPng, qrStandeePdf } from "@/server/merchant/qr-print";
import { captureUserEvent } from "@/server/observability/analytics";

const TYPES = { png: "image/png", pdf: "application/pdf" } as const;

/** The merchant's QR Ph code to print: `?format=png` (the code) or `pdf` (an A5 standee). */
export const GET = route(async (req) => {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  if (!merchant.qrphRaw) throw badRequest("No QRPH linked yet");
  const format = req.nextUrl.searchParams.get("format");
  if (format !== "png" && format !== "pdf") throw badRequest("format must be png or pdf");

  const file =
    format === "png"
      ? await qrPng(merchant.qrphRaw)
      : qrStandeePdf({
          raw: merchant.qrphRaw,
          businessName: merchant.businessName,
          city: merchant.qrphMerchantCity,
        });
  captureUserEvent("merchant_qr_downloaded", user, { merchant_id: merchant.id, format });
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "content-type": TYPES[format],
      "content-disposition": `attachment; filename="${qrFileName(merchant.businessName)}.${format}"`,
      "cache-control": "private, no-store",
    },
  });
});
