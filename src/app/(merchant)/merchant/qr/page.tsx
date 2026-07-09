import QRCode from "qrcode";
import Link from "next/link";
import { requireRole } from "@/server/auth/sessions";
import { requireMerchant } from "@/server/merchant/service";
import { BusinessQrCard } from "@/components/merchant/BusinessQrCard";

export default async function MerchantQrPage() {
  const user = await requireRole("MERCHANT");
  const merchant = await requireMerchant(user.id);

  if (!merchant.qrphRaw) {
    return (
      <div className="tonal-card mx-auto max-w-lg rounded-xl p-margin-desktop text-center">
        <p className="text-headline-md">No QRPH linked yet</p>
        <Link href="/merchant/onboarding" className="mt-stack-md inline-block text-primary">
          Link your QRPH
        </Link>
      </div>
    );
  }

  const qrSvg = await QRCode.toString(merchant.qrphRaw, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });
  const paymentLink = `${process.env.APP_URL ?? ""}/pay?m=${merchant.id}`;

  return (
    <BusinessQrCard qrSvg={qrSvg} paymentLink={paymentLink} businessName={merchant.businessName} />
  );
}
