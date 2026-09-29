import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/sessions";
import { adminMustChangePassword } from "@/server/admin/gate";
import { AdminSideNav } from "@/components/admin/AdminSideNav";
import { AdminMobileNav } from "@/components/admin/AdminMobileNav";
import { AnalyticsIdentify } from "@/components/analytics/PostHogProvider";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/403");
  if (await adminMustChangePassword(user.id)) redirect("/admin/settings/password");

  return (
    <div className="min-h-screen bg-background">
      <AnalyticsIdentify userId={user.id} role={user.role} username={user.username} />
      <AdminSideNav />
      <AdminMobileNav />
      <main className="px-margin-mobile pb-24 pt-stack-lg lg:ml-64 lg:px-margin-desktop lg:pb-stack-lg">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
