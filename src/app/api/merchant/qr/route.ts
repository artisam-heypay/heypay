import QRCode from "qrcode";
import { route, json } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireRole } from "@/server/auth/sessions";
import { getMerchantForUser } from "@/server/merchant/service";

export const GET = route(async () => {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  if (!merchant.qrphRaw) throw badRequest("No QRPH linked yet");

  const qrSvg = await QRCode.toString(merchant.qrphRaw, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });
  const base = process.env.APP_URL ?? "";
  const paymentLink = `${base}/pay?m=${merchant.id}`;
  return json({ qrphRaw: merchant.qrphRaw, qrSvg, paymentLink });
});
