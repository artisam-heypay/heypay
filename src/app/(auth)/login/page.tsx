import { authNotice } from "@/lib/auth-notices";
import { googleEnabled } from "@/server/auth/google";
import { LoginForm } from "@/components/auth/LoginForm";

type Props = { searchParams: Promise<{ error?: string | string[] }> };

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  return <LoginForm googleEnabled={googleEnabled()} notice={authNotice(error)} />;
}
