import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { getFaucetStatus } from "@/server/payer/faucet";
import { getOwnWallet, nonCustodialEnabled, ownWalletAccount } from "@/server/wallet/external";
import { Scanner } from "@/components/payer/Scanner";
import { TestShopQrCard } from "@/components/payer/TestShopQrCard";
import { isMainnet } from "@/server/stellar/horizon";

export default async function PayerScanPage() {
  const user = await requireRole(Role.PAYER);
  // The test shop only exists for testers; never offer it against real money.
  const showTestShop = !isMainnet();
  // A payer short of XLM is offered the free test XLM here, as on the Dashboard.
  // It funds the HeyPay wallet, so not while their own wallet pays.
  const [faucet, own] = await Promise.all([
    getFaucetStatus(user.id),
    nonCustodialEnabled() ? getOwnWallet(user.id) : null,
  ]);
  const faucetXlm =
    faucet.enabled && !faucet.claimed && !(own && ownWalletAccount(own)) ? faucet.amountXlm : null;

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
        <Scanner faucetXlm={faucetXlm} />
      </div>
      {showTestShop && <TestShopQrCard />}
    </div>
  );
}
