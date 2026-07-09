import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { Icon } from "@/components/ui";
import { ProfileCard } from "@/components/payer/ProfileCard";
import { ChangePasswordForm } from "@/components/payer/ChangePasswordForm";

export default async function PayerSettingsPage() {
  const user = await requireRole(Role.PAYER);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-stack-lg">
      <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Settings</h1>
      <ProfileCard username={user.username} role={user.role} />
      <ChangePasswordForm />
      <a
        href="/logout"
        className="flex min-h-11 items-center justify-center gap-stack-md rounded-lg px-stack-md py-2 text-body-md text-error hover:bg-error/5 focus:outline-none focus:ring-4 focus:ring-primary/10 lg:hidden"
      >
        <Icon name="logout" />
        Logout
      </a>
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
