import Link from "next/link";
import { Card, Icon } from "@/components/ui";

export function MerchantNotRegistered({ onScanAgain }: { onScanAgain?: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-stack-md text-center">
      <Icon name="error" className="text-5xl text-error" />
      <h2 className="font-display text-headline-md">Merchant not registered</h2>
      <p className="text-body-md text-on-surface-variant">
        This QRPH code is not linked to a HeyPay merchant yet, so it can&apos;t be paid here.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-stack-md">
        <button
          type="button"
          onClick={onScanAgain}
          className="inline-flex min-h-11 items-center gap-stack-sm rounded-full border-2 border-primary px-stack-lg py-3 font-display font-bold text-primary hover:bg-primary/5 focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          Scan again
        </button>
        <Link
          href="/payer/dashboard"
          className="rounded-lg text-body-md text-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          Back to dashboard
        </Link>
      </div>
    </Card>
  );
}
