import { requireRole } from "@/server/auth/sessions";
import { requireMerchant, serializeMerchant } from "@/server/merchant/service";
import { SettingsForms } from "@/components/merchant/SettingsForms";
import { Icon } from "@/components/ui";
import { LogoutButton } from "@/components/auth/LogoutButton";

export default async function MerchantSettingsPage() {
  const user = await requireRole("MERCHANT");
  const merchant = await requireMerchant(user.id);
  return (
    <div className="flex flex-col gap-stack-lg">
      <h1 className="text-headline-lg-mobile lg:text-headline-lg">Settings</h1>
      <SettingsForms merchant={serializeMerchant(merchant)} />
      <LogoutButton className="flex min-h-11 items-center justify-center gap-stack-md rounded-lg px-stack-md py-2 text-body-md text-error hover:bg-error/5 focus:outline-none focus:ring-4 focus:ring-primary/10 lg:hidden">
        <Icon name="logout" />
        Logout
      </LogoutButton>
    </div>
  );
}
