"use client";
import { useActionState } from "react";
import { resendSignupCodeAction, verifySignupAction, type AuthState } from "@/app/(auth)/actions";
import { FloatingInput } from "@/components/auth/FloatingInput";

export function VerifyCodeForm({ email }: { email: string }) {
  const [state, verifyAction, verifying] = useActionState<AuthState, FormData>(
    verifySignupAction,
    {},
  );
  const [resent, resendAction, resending] = useActionState<AuthState, FormData>(
    resendSignupCodeAction,
    {},
  );
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-stack-lg p-margin-mobile">
      <h1 className="text-headline-lg font-display text-primary">Check your email</h1>
      <p className="text-body-md text-on-surface">
        We sent a 6-digit code to <strong className="break-all">{email}</strong>. Enter it to finish
        creating your account. The code works for 10 minutes.
      </p>
      <form action={verifyAction} className="flex flex-col gap-gutter">
        <FloatingInput
          id="code"
          name="code"
          label="6-digit code"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          pattern="[0-9]{6}"
          required
        />
        {state.error ? (
          <p role="alert" className="text-body-sm text-error">
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={verifying}
          className="rounded-full bg-primary py-4 text-headline-md font-display text-on-primary shadow-lg shadow-primary/20 transition hover:brightness-110 active:scale-95 disabled:opacity-60 focus:ring-4 focus:ring-primary/10"
        >
          {verifying ? "Checking…" : "Confirm and create account"}
        </button>
      </form>
      <form action={resendAction} className="flex flex-col items-center gap-stack-sm">
        <button
          type="submit"
          disabled={resending}
          className="inline-flex min-h-11 items-center text-body-sm text-primary underline disabled:opacity-60"
        >
          {resending ? "Sending…" : "Send a new code"}
        </button>
        {resent.error ? (
          <p role="alert" className="text-center text-body-sm text-error">
            {resent.error}
          </p>
        ) : null}
        {resent.notice ? (
          <p role="status" className="text-center text-body-sm text-on-surface-variant">
            {resent.notice}
          </p>
        ) : null}
      </form>
      <a href="/signup" className="text-center text-body-sm text-primary">
        Use a different email
      </a>
    </main>
  );
}
