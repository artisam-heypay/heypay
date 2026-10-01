import { requireRole } from "@/server/auth/sessions";
import { getMerchantForUserOrNull, serializeMerchant } from "@/server/merchant/service";
import { OnboardingWizard } from "@/components/merchant/onboarding/OnboardingWizard";

export default async function OnboardingPage() {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUserOrNull(user.id);
  return (
    <div className="mx-auto max-w-5xl">
      <OnboardingWizard initial={merchant ? serializeMerchant(merchant) : null} />
    </div>
  );
}
