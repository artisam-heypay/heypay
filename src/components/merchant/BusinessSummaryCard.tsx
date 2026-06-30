import Link from "next/link";
import type { MerchantDto } from "@/server/merchant/service";

export function BusinessSummaryCard({ merchant }: { merchant: MerchantDto }) {
  return (
    <div className="tonal-card flex flex-col gap-stack-md rounded-xl p-stack-lg">
      <div className="flex items-center gap-stack-md">
        <span className="material-symbols-outlined icon-filled text-primary">qr_code_2</span>
        <p className="text-headline-md">Business QR &amp; settlement</p>
      </div>
      <div className="rounded-lg bg-surface-container-low p-stack-md">
        <p className="text-label-md uppercase text-on-surface-variant">Settles to</p>
        <p className="font-mono text-mono-data text-on-surface">
          {merchant.settlementBankName} •••• {merchant.accountNumberLast4}
        </p>
      </div>
      <Link
        href="/merchant/qr"
        className="inline-flex min-h-11 items-center justify-center gap-stack-sm rounded-lg border-2 border-primary px-stack-md py-stack-sm text-body-md font-medium text-primary"
      >
        View &amp; share QR
        <span className="material-symbols-outlined">arrow_forward</span>
      </Link>
    </div>
  );
}
