import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/sessions";
import { adminMustChangePassword } from "@/server/admin/gate";
import { AdminSideNav } from "@/components/admin/AdminSideNav";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/403");
  if (await adminMustChangePassword(user.id)) redirect("/admin/settings/password");

  return (
    <div className="min-h-screen bg-background">
      <AdminSideNav />
      <main className="px-margin-mobile py-stack-lg lg:ml-64 lg:px-margin-desktop">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
