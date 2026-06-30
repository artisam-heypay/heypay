import Link from "next/link";
import { Button, Icon } from "@/components/ui";

export function ScanQrphCard() {
  return (
    <section className="flex flex-col gap-stack-md rounded-xl bg-primary p-stack-lg text-on-primary">
      <Icon name="qr_code_scanner" className="text-5xl" />
      <div>
        <h2 className="text-headline-md font-display font-bold">Scan QRPH</h2>
        <p className="text-body-sm opacity-90">Pay any QRPH merchant instantly</p>
      </div>
      <Link href="/payer/scan" className="mt-auto">
        <Button variant="secondary-pill" trailingIcon="arrow_forward" className="w-full">
          Start Payment
        </Button>
      </Link>
    </section>
  );
}
