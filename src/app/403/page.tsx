import type { Metadata } from "next";
import { getSessionUser } from "@/server/auth/sessions";
import { dashboardPath } from "@/lib/auth-redirect";
import { ErrorScreen } from "@/components/ui/ErrorScreen";
import { LogoutButton } from "@/components/auth/LogoutButton";

export const metadata: Metadata = { title: "No access · HeyPay" };

const ACCOUNT: Record<string, string> = {
  PAYER: "a payer",
  MERCHANT: "a business",
  ADMIN: "an admin",
};

// Shown in place of a page the signed-in account has no access to: the proxy
// serves it with a 403 for a payer opening /merchant, and so on.
export default async function ForbiddenPage() {
  const user = await getSessionUser();
  return (
    <ErrorScreen
      code={403}
      icon="lock"
      title="This page isn't for your account"
      home={
        user
          ? { href: dashboardPath(user.role), label: "Back to my dashboard" }
          : { href: "/login", label: "Log in" }
      }
      extra={
        user ? (
          <LogoutButton className="inline-flex min-h-11 items-center rounded-full px-stack-md font-display font-bold text-primary hover:bg-primary/5">
            Log in with another account
          </LogoutButton>
        ) : null
      }
    >
      {user
        ? `You're signed in with ${ACCOUNT[user.role] ?? "another"} account, and this page belongs to a different kind of account.`
        : "Log in with the account this page belongs to."}
    </ErrorScreen>
  );
}
