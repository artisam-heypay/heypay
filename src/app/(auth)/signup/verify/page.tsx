import { redirect } from "next/navigation";
import { pendingSignupEmail } from "@/server/auth/signup";
import { VerifyCodeForm } from "@/components/auth/VerifyCodeForm";

// Step two of email sign-up. Only reachable with a sign-up in progress in this
// browser; anyone else is sent back to step one.
export default async function VerifySignupPage() {
  const email = await pendingSignupEmail();
  if (!email) redirect("/signup");
  return <VerifyCodeForm email={email} />;
}
