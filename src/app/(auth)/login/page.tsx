"use client";
import { useActionState } from "react";
import { loginAction, type AuthState } from "../actions";
import { FloatingInput } from "@/components/auth/FloatingInput";

// Seeded UAT logins (see prisma/seed.ts). Surfaced so testers can sign in without
// out-of-band credentials — mirror any change to the seed here.
const TEST_ACCOUNTS = [
  { role: "Payer", username: "Payer5", password: "12345678" },
  { role: "Merchant", username: "merchant2", password: "12345678" },
] as const;

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(loginAction, {});
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-stack-lg p-margin-mobile">
      <h1 className="text-headline-lg font-display text-primary">HeyPay</h1>
      <form action={formAction} className="flex flex-col gap-gutter">
        <FloatingInput
          id="username"
          name="username"
          label="Username"
          autoComplete="username"
          required
        />
        <FloatingInput
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
        />
        {state.error ? (
          <p role="alert" className="text-body-sm text-error">
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-primary py-4 text-headline-md font-display text-on-primary shadow-lg shadow-primary/20 transition hover:brightness-110 active:scale-95 disabled:opacity-60 focus:ring-4 focus:ring-primary/10"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <a href="/signup" className="text-center text-body-sm text-primary">
        Create an account
      </a>
      <section className="rounded-lg border border-outline-variant bg-surface-container-lowest p-4">
        <p className="mb-3 text-label-md uppercase tracking-wide text-on-surface-variant">
          Test accounts
        </p>
        <dl className="flex flex-col gap-4">
          {TEST_ACCOUNTS.map((acct) => (
            <div key={acct.username} className="flex flex-col gap-1">
              <p className="text-label-md uppercase text-primary">{acct.role}</p>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-body-sm text-on-surface-variant">Username</dt>
                <dd className="font-mono text-mono-data text-on-surface">{acct.username}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-body-sm text-on-surface-variant">Password</dt>
                <dd className="font-mono text-mono-data text-on-surface">{acct.password}</dd>
              </div>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
