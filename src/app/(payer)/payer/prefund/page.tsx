import QRCode from "qrcode";
import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { dec } from "@/lib/money";
import { MoneyAmount } from "@/components/ui";
import { getWalletSummary } from "@/server/payer/data";
import { rail } from "@/server/rails";
import { DepositCard } from "@/components/payer/DepositCard";
import { PendingDepositWatcher } from "@/components/payer/PendingDepositWatcher";

export default async function PayerPrefundPage() {
  const user = await requireRole(Role.PAYER);
  const wallet = await getWalletSummary(user.id);
  const balance = wallet?.balanceXlm ?? dec("0");

  let approxPhp = dec("0");
  try {
    const quote = await rail.getQuote({ sell: "XLM", buy: "PHP", phpAmount: dec("1") });
    approxPhp = balance.times(quote.rate);
  } catch {
    // rate unavailable
  }

  const qrSvg = wallet ? await QRCode.toString(wallet.publicKey, { type: "svg", margin: 1 }) : "";

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-stack-lg">
      <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Prefund Account</h1>
      <div>
        <p className="text-label-md uppercase text-on-surface-variant">Current Balance</p>
        <MoneyAmount xlm={balance} php={approxPhp} size="display" />
      </div>
      <PendingDepositWatcher initialBalance={balance.toFixed(7)} />
      {wallet && <DepositCard publicKey={wallet.publicKey} qrSvg={qrSvg} />}
    </div>
  );
}
