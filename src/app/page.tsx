import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/sessions";

// SPEC §5: `/` redirects — authed users to their role dashboard, everyone else to /login.
const ROLE_HOME: Record<string, string> = {
  PAYER: "/payer/dashboard",
  MERCHANT: "/merchant/dashboard",
  ADMIN: "/admin",
};

export default async function HomePage() {
  const user = await getSessionUser();
  redirect(user ? (ROLE_HOME[user.role] ?? "/login") : "/login");
}
