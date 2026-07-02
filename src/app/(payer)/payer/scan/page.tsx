import { Scanner } from "@/components/payer/Scanner";

export default function PayerScanPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-stack-lg">
      <div>
        <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Scan to Pay</h1>
        <p className="mt-stack-sm text-body-md text-on-surface-variant">
          Point your camera at a QRPH code or upload a photo of it. We&apos;ll resolve the merchant
          and lock an exchange rate before you confirm.
        </p>
      </div>
      <Scanner />
    </div>
  );
}
