"use client";
import { useActionState } from "react";
import { signupAction, type AuthState } from "../actions";
import { FloatingInput } from "@/components/auth/FloatingInput";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signupAction, {});
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-stack-lg p-margin-mobile">
      <h1 className="text-headline-lg font-display text-primary">Create your HeyPay account</h1>
      <form action={formAction} className="flex flex-col gap-gutter">
        <fieldset className="grid grid-cols-2 gap-stack-sm">
          <legend className="mb-stack-sm text-label-md uppercase text-on-surface-variant">
            I am a
          </legend>
          {/* radio-card role chooser: has-[:checked] highlights the selected card */}
          <label className="cursor-pointer rounded-lg border border-outline-variant p-gutter text-center has-[:checked]:border-primary has-[:checked]:bg-primary-container">
            <input type="radio" name="role" value="PAYER" defaultChecked className="sr-only" />
            <span className="text-body-md font-display">Payer</span>
          </label>
          <label className="cursor-pointer rounded-lg border border-outline-variant p-gutter text-center has-[:checked]:border-primary has-[:checked]:bg-primary-container">
            <input type="radio" name="role" value="MERCHANT" className="sr-only" />
            <span className="text-body-md font-display">Merchant</span>
          </label>
        </fieldset>
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
          autoComplete="new-password"
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
          {pending ? "Creating…" : "Create account"}
        </button>
      </form>
      <a href="/login" className="text-center text-body-sm text-primary">
        I already have an account
      </a>
    </main>
  );
}
