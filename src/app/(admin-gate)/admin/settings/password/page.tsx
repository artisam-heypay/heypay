import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/sessions";
import { ChangePasswordForm } from "@/components/admin/ChangePasswordForm";
import { LogoutButton } from "@/components/auth/LogoutButton";

// Deliberately outside the (admin) route group: that layout redirects here whenever the
// force-change gate is unsatisfied, so inheriting it would redirect this page to itself.
// Auth is re-checked here because the layout's checks do not apply.
export default async function AdminPasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/403");

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-stack-lg p-margin-mobile">
      <div className="flex flex-col gap-stack-sm">
        <h1 className="text-headline-lg font-display text-primary">Change your password</h1>
        <p className="text-body-md text-on-surface-variant">
          Set a new password for{" "}
          <span className="font-mono text-mono-data text-on-surface">{user.username}</span> before
          using the admin console.
        </p>
      </div>
      <ChangePasswordForm />
      <LogoutButton className="text-center text-body-sm text-error">Log out</LogoutButton>
    </main>
  );
}
