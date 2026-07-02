import { requireRole } from "@/server/auth/sessions";
import { requireMerchant, serializeMerchant } from "@/server/merchant/service";
import { SettingsForms } from "@/components/merchant/SettingsForms";

export default async function MerchantSettingsPage() {
  const user = await requireRole("MERCHANT");
  const merchant = await requireMerchant(user.id);
  return (
    <div className="flex flex-col gap-stack-lg">
      <h1 className="text-headline-lg-mobile lg:text-headline-lg">Settings</h1>
      <SettingsForms merchant={serializeMerchant(merchant)} />
    </div>
  );
}
