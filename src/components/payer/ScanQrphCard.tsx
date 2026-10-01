import Link from "next/link";
import { Icon } from "@/components/ui";

export function ScanQrphCard() {
  return (
    <div className="flex flex-col items-start gap-stack-md rounded-xl bg-primary p-stack-lg text-on-primary">
      <Icon name="qr_code_scanner" className="text-5xl" />
      <h2 className="font-display text-headline-md">Scan QRPH</h2>
      <p className="text-body-md text-on-primary/80">Pay any QRPH merchant instantly</p>
      <Link
        href="/payer/scan"
        className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-secondary px-stack-lg py-3 font-display font-bold text-on-secondary hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-primary/10"
      >
        Start Payment
        <Icon name="arrow_forward" />
      </Link>
    </div>
  );
}
