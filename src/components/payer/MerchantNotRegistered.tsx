import Link from "next/link";
import { Button, Card, Icon } from "@/components/ui";

export function MerchantNotRegistered({ onScanAgain }: { onScanAgain?: () => void }) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-stack-md py-stack-lg text-center">
        <Icon name="error" className="text-5xl text-error" />
        <h2 className="text-headline-md font-display">Merchant not registered</h2>
        <p className="max-w-sm text-body-sm text-on-surface-variant">
          This QR code is valid, but the merchant isn&apos;t set up to receive HeyPay payments yet.
          Ask them to register, or try a different code.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-stack-md">
          <Button variant="outline-pill" trailingIcon="qr_code_scanner" onClick={onScanAgain}>
            Scan again
          </Button>
          <Link href="/payer/dashboard" className="text-body-sm text-primary">
            Back to dashboard
          </Link>
        </div>
      </div>
    </Card>
  );
}
