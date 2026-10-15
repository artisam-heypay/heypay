import { authNotice } from "@/lib/auth-notices";
import { googleEnabled } from "@/server/auth/google";
import { emailEnabled } from "@/server/email/send";
import { SignupForm } from "@/components/auth/SignupForm";

type Props = { searchParams: Promise<{ error?: string | string[] }> };

export default async function SignupPage({ searchParams }: Props) {
  const { error } = await searchParams;
  return (
    <SignupForm
      googleEnabled={googleEnabled()}
      emailEnabled={emailEnabled()}
      notice={authNotice(error)}
    />
  );
}
