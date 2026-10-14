import { Card, Icon } from "@/components/ui";

/**
 * Shown on a HeyPay-wallet page (prefund, swap) while the payer pays from their
 * own wallet, so they do not take this wallet for the one that pays.
 */
export function OwnWalletNotice({ children }: { children: React.ReactNode }) {
  return (
    <Card className="flex items-start gap-stack-sm bg-primary-container text-on-primary-container">
      <Icon name="info" className="shrink-0" />
      <p className="text-body-md">{children}</p>
    </Card>
  );
}
