import Link from "next/link";
import { QrDownloads } from "./QrDownloads";

/**
 * What a merchant who has just gone live does next: put the QR where customers
 * pay. Shown on the dashboard until the first payment comes in.
 */
export function LiveQrCard({ payoutTo }: { payoutTo: string }) {
  return (
    <section
      aria-labelledby="live-qr-heading"
      className="flex flex-col gap-stack-md rounded-xl border border-primary/30 bg-primary-container/30 p-stack-lg lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="flex items-start gap-stack-md">
        <span className="material-symbols-outlined icon-filled text-4xl text-primary" aria-hidden>
          verified
        </span>
        <div className="flex flex-col gap-1">
          <h2 id="live-qr-heading" className="font-display text-headline-md text-on-surface">
            You&apos;re live — print your QR
          </h2>
          <p className="text-body-sm text-on-surface-variant">
            Put it where customers pay. They scan it with HeyPay or any QRPH app, and you get pesos
            in {payoutTo}.{" "}
            <Link href="/merchant/qr" className="font-medium text-primary underline">
              See your QR
            </Link>
          </p>
        </div>
      </div>
      <div className="w-full lg:w-auto lg:min-w-80">
        <QrDownloads />
      </div>
    </section>
  );
}
