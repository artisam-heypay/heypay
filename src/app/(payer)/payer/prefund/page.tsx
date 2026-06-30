import "server-only";
import QRCode from "qrcode";
import { Role } from "@/generated/prisma";
import { requireRole } from "@/server/auth/sessions";
import { getWalletSummary } from "@/server/payer/data";
import { MoneyAmount } from "@/components/ui";
import { DepositCard } from "@/components/payer/DepositCard";
import { PendingDepositWatcher } from "@/components/payer/PendingDepositWatcher";

export default async function PrefundPage() {
  const user = await requireRole(Role.PAYER);
  const summary = await getWalletSummary(user.id);
  const publicKey = summary?.publicKey ?? "";
  const qrSvg = publicKey ? await QRCode.toString(publicKey, { type: "svg", margin: 1 }) : "";

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-stack-lg">
      <h1 className="text-headline-lg font-display font-bold">Prefund Account</h1>
      {summary ? (
        <div className="rounded-xl bg-surface-container-lowest p-stack-lg">
          <p className="text-label-md uppercase text-on-surface-variant">Current balance</p>
          <MoneyAmount xlm={summary.balanceXlm} php={summary.approxPhp} />
        </div>
      ) : null}
      <DepositCard publicKey={publicKey} qrSvg={qrSvg} />
      <PendingDepositWatcher initialBalance={summary?.balanceXlm.toFixed(7) ?? "0.0000000"} />
    </div>
  );
}
