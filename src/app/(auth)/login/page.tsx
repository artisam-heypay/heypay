"use client";
import { useActionState } from "react";
import { loginAction, type AuthState } from "../actions";
import { FloatingInput } from "@/components/auth/FloatingInput";

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
    </main>
  );
}
