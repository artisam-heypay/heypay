import { headers } from "next/headers";
import { requireRole } from "@/server/auth/sessions";
import { getMerchantForUserOrNull, merchantSetupState } from "@/server/merchant/service";
import { SideNav } from "@/components/merchant/SideNav";
import { MobileNav } from "@/components/merchant/MobileNav";
import { SetupBanner } from "@/components/merchant/SetupBanner";

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUserOrNull(user.id);
  const pathname = (await headers()).get("x-pathname") ?? "";
  const setup = merchant
    ? merchantSetupState(merchant)
    : { hasBusiness: false, hasSettlement: false, hasQrph: false, isComplete: false };

  return (
    <div className="min-h-screen bg-background text-on-background">
      <SideNav businessName={merchant?.businessName || "Your business"} pathname={pathname} />
      <main className="px-margin-mobile pb-24 pt-stack-lg lg:ml-64 lg:px-margin-desktop lg:pb-stack-lg">
        <div className="mx-auto max-w-7xl">
          {/* Onboarding route renders its own focused shell; banner shown on all others. */}
          {!pathname.endsWith("/onboarding") && <SetupBanner setup={setup} />}
          {children}
        </div>
      </main>
      <MobileNav pathname={pathname} />
    </div>
  );
}
