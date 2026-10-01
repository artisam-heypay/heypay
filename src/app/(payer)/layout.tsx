import "server-only";
import { Role } from "@/generated/prisma/client";
import { requireRole } from "@/server/auth/sessions";
import { SideNav } from "@/components/payer/SideNav";
import { MobileNav } from "@/components/payer/MobileNav";

export default async function PayerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(Role.PAYER); // throws forbidden() handled by proxy/error boundary
  return (
    <div className="min-h-dvh bg-background text-on-background">
      <SideNav username={user.username} />
      <main className="px-margin-mobile pb-24 pt-stack-lg lg:ml-64 lg:px-margin-desktop lg:pb-margin-desktop">
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>
      <MobileNav />
    </div>
  );
}
