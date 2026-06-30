import "server-only";
import type { ReactNode } from "react";
import { Role } from "@/generated/prisma";
import { requireRole } from "@/server/auth/sessions";
import { getMerchantForUserOrNull, merchantSetupState } from "@/server/merchant/service";
import { SideNav } from "@/components/merchant/SideNav";
import { MobileNav } from "@/components/merchant/MobileNav";
import { SetupBanner } from "@/components/merchant/SetupBanner";

const EMPTY_SETUP = {
  hasBusiness: false,
  hasSettlement: false,
  hasQrph: false,
  isComplete: false,
} as const;

export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const user = await requireRole(Role.MERCHANT); // throws forbidden() handled by proxy/error boundary
  const merchant = await getMerchantForUserOrNull(user.id);
  const setup = merchant ? merchantSetupState(merchant) : EMPTY_SETUP;

  return (
    <div className="min-h-dvh bg-background text-on-background">
      <SideNav businessName={merchant?.businessName || "Your business"} />
      <main className="px-margin-mobile pb-24 pt-stack-lg lg:ml-64 lg:px-margin-desktop lg:pb-margin-desktop">
        <div className="mx-auto w-full max-w-7xl">
          <SetupBanner setup={setup} />
          {children}
        </div>
      </main>
      <MobileNav />
    </div>
  );
}
