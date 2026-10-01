import { Card, Icon } from "@/components/ui";

export const TEST_SHOP_QR_PATH = "/test-qr/heypay-test-shop.png";

/**
 * Testnet helper beside the scanner: the HeyPay Test Shop's QRPH code, to
 * download and upload (or scan from another screen) for a practice payment.
 */
export function TestShopQrCard() {
  return (
    <Card className="flex flex-col gap-stack-md">
      <div>
        <h2 className="font-display text-headline-md">Test shop QR</h2>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          No shop nearby? Download this code for the HeyPay Test Shop, then choose{" "}
          <span className="font-bold">Upload image</span> to make a practice payment.
        </p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- static PNG; nothing to optimize */}
      <img
        src={TEST_SHOP_QR_PATH}
        alt="QRPH code for the HeyPay Test Shop"
        width={640}
        height={640}
        className="mx-auto w-48 rounded-xl border border-outline-variant lg:w-full"
      />
      <a
        href={TEST_SHOP_QR_PATH}
        download="heypay-test-shop.png"
        className="inline-flex min-h-11 items-center justify-center gap-stack-sm rounded-full border-2 border-primary px-stack-md py-3 font-display font-bold text-primary hover:bg-primary/5 focus:outline-none focus:ring-4 focus:ring-primary/10"
      >
        Download QR
        <Icon name="download" />
      </a>
    </Card>
  );
}
