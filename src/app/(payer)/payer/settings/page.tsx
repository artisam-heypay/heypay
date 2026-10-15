import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { stellarTxUrl } from "@/lib/stellar-explorer";
import { getWalletSummary } from "@/server/payer/data";
import { walletService } from "@/server/stellar/wallet";
import { Card, Icon } from "@/components/ui";
import { ProfileCard } from "@/components/payer/ProfileCard";
import { TurnOnAsset } from "@/components/payer/TurnOnAsset";
import { ChangePasswordForm } from "@/components/payer/ChangePasswordForm";
import { LogoutButton } from "@/components/auth/LogoutButton";

export default async function PayerSettingsPage() {
  const user = await requireRole(Role.PAYER);

  // Offered only while USDC is an enabled payment asset. Whether it is on is the
  // chain's answer; the cached flag stands in only when Horizon is unreachable.
  const wallet = await getWalletSummary(user.id);
  const usdc = wallet?.balances.find((b) => b.asset === "USDC");
  let usdcOn = usdc?.canReceive ?? false;
  if (wallet && usdc) {
    try {
      usdcOn = await walletService.canReceive(wallet.publicKey, "USDC");
    } catch {
      // Horizon down: keep the cached flag.
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-stack-lg">
      <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Settings</h1>
      <ProfileCard username={user.username} role={user.role} />
      {usdc && (
        <Card className="flex flex-col gap-stack-md">
          <h2 className="font-display text-headline-md">USDC</h2>
          <TurnOnAsset
            asset="USDC"
            on={usdcOn}
            txUrl={usdc.trustlineTxHash ? stellarTxUrl(usdc.trustlineTxHash) : null}
          />
        </Card>
      )}
      <ChangePasswordForm />
      <LogoutButton className="flex min-h-11 items-center justify-center gap-stack-md rounded-lg px-stack-md py-2 text-body-md text-error hover:bg-error/5 focus:outline-none focus:ring-4 focus:ring-primary/10 lg:hidden">
        <Icon name="logout" />
        Logout
      </LogoutButton>
      <footer className="flex flex-col items-center gap-1 pt-stack-lg text-center">
        <span className="flex items-center gap-stack-sm text-label-md uppercase text-on-surface-variant">
          <Icon name="lock" />
          End-to-end encrypted
        </span>
        <span className="text-body-sm text-on-surface-variant">HeyPay • Licensed by BSP</span>
      </footer>
    </div>
  );
}
