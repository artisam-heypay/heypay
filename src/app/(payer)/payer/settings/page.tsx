import "server-only";
import { getSessionUser } from "@/server/auth/sessions";
import { Icon } from "@/components/ui";
import { ProfileCard } from "@/components/payer/ProfileCard";
import { ChangePasswordForm } from "@/components/payer/ChangePasswordForm";

export default async function SettingsPage() {
  const user = await getSessionUser();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-stack-lg">
      <h1 className="text-headline-lg font-display font-bold">Settings</h1>
      {user ? <ProfileCard username={user.username} role={user.role} /> : null}
      <ChangePasswordForm />
      <footer className="flex flex-col items-center gap-stack-sm py-stack-lg text-center text-body-sm text-on-surface-variant">
        <span className="flex items-center gap-stack-sm text-label-md uppercase">
          <Icon name="lock" className="text-primary" /> End-to-end encrypted
        </span>
        <span>HeyPay v2.4.0 • Licensed by BSP</span>
      </footer>
    </div>
  );
}
