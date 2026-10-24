import type { Metadata } from "next";
import { getSessionUser } from "@/server/auth/sessions";
import { dashboardPath } from "@/lib/auth-redirect";
import { ErrorScreen } from "@/components/ui/ErrorScreen";

export const metadata: Metadata = { title: "Page not found · HeyPay" };

// Unknown URLs, and pages that call notFound() (a payment that isn't the payer's).
export default async function NotFound() {
  const user = await getSessionUser();
  return (
    <ErrorScreen
      code={404}
      icon="travel_explore"
      title="We can't find that page"
      home={
        user
          ? { href: dashboardPath(user.role), label: "Back to my dashboard" }
          : { href: "/login", label: "Log in" }
      }
    >
      The link may be old or mistyped, or the page may belong to another account.
    </ErrorScreen>
  );
}
