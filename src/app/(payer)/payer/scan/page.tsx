import { Scanner } from "@/components/payer/Scanner";
import { TestShopQrCard } from "@/components/payer/TestShopQrCard";

export default function PayerScanPage() {
  // The test shop only exists for testers; never offer it against real money.
  const showTestShop = process.env.STELLAR_NETWORK !== "mainnet";

  return (
    <div
      className={
        showTestShop
          ? "mx-auto grid max-w-5xl items-start gap-stack-lg lg:grid-cols-[minmax(0,32rem)_18rem] lg:justify-center"
          : "mx-auto flex max-w-lg flex-col gap-stack-lg"
      }
    >
      <div className="flex flex-col gap-stack-lg">
        <div>
          <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Scan to Pay</h1>
          <p className="mt-stack-sm text-body-md text-on-surface-variant">
            Point your camera at a QRPH code or upload a photo of it. We&apos;ll resolve the
            merchant and lock an exchange rate before you confirm.
          </p>
        </div>
        <Scanner />
      </div>
      {showTestShop && <TestShopQrCard />}
    </div>
  );
}
