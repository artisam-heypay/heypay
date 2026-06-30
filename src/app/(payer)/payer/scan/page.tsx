import { Scanner } from "@/components/payer/Scanner";

export default function ScanPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-stack-lg">
      <div>
        <h1 className="text-headline-lg font-display font-bold text-on-surface">Scan to Pay</h1>
        <p className="text-body-sm text-on-surface-variant">
          Point your camera at any QRPH code, or upload a photo of one. We&apos;ll handle the
          XLM→PHP conversion and pay the merchant.
        </p>
      </div>
      <Scanner />
    </div>
  );
}
