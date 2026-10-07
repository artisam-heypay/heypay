"use client";
import { useActionState, useState } from "react";
import { signupAction, type AuthState } from "@/app/(auth)/actions";
import { FloatingInput } from "@/components/auth/FloatingInput";
import { GoogleButton, OrDivider } from "@/components/auth/GoogleButton";

type Role = "PAYER" | "MERCHANT";
const ROLES: { value: Role; label: string }[] = [
  { value: "PAYER", label: "Payer" },
  { value: "MERCHANT", label: "Merchant" },
];

type Props = {
  googleEnabled: boolean;
  /** False when no sign-up code could be emailed; the email fields are then left out. */
  emailEnabled: boolean;
  /** Why a Google sign-in sent the person back here, if it did. */
  notice: string | null;
};

export function SignupForm({ googleEnabled, emailEnabled, notice }: Props) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signupAction, {});
  // Held in state because the Google link needs it too, and so the choice
  // survives the form reset that follows a refused sign-up.
  const [role, setRole] = useState<Role>("PAYER");
  const error = state.error ?? notice;
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-stack-lg p-margin-mobile">
      <h1 className="text-headline-lg font-display text-primary">Create your HeyPay account</h1>
      <form action={formAction} className="flex flex-col gap-gutter">
        <fieldset className="grid grid-cols-2 gap-stack-sm">
          <legend className="mb-stack-sm text-label-md uppercase text-on-surface-variant">
            I am a
          </legend>
          {/* radio-card role chooser: has-[:checked] highlights the selected card */}
          {ROLES.map((r) => (
            <label
              key={r.value}
              className="cursor-pointer rounded-lg border border-outline-variant p-gutter text-center has-[:checked]:border-primary has-[:checked]:bg-primary-container"
            >
              <input
                type="radio"
                name="role"
                value={r.value}
                checked={role === r.value}
                onChange={() => setRole(r.value)}
                className="sr-only"
              />
              <span className="text-body-md font-display">{r.label}</span>
            </label>
          ))}
        </fieldset>
        {googleEnabled ? <GoogleButton role={role} /> : null}
        {googleEnabled && emailEnabled ? <OrDivider label="or use your email" /> : null}
        {emailEnabled ? (
          <>
            <FloatingInput
              id="email"
              name="email"
              label="Email"
              type="email"
              autoComplete="email"
              required
            />
            <FloatingInput
              id="password"
              name="password"
              label="Password (at least 8 characters)"
              type="password"
              autoComplete="new-password"
              required
            />
            <p className="text-body-sm text-on-surface-variant">
              We will email you a 6-digit code to confirm the address.
            </p>
          </>
        ) : null}
        {!googleEnabled && !emailEnabled ? (
          <p role="alert" className="text-body-sm text-error">
            Sign-up is not available right now. Please try again later.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        ) : null}
        {emailEnabled ? (
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-primary py-4 text-headline-md font-display text-on-primary shadow-lg shadow-primary/20 transition hover:brightness-110 active:scale-95 disabled:opacity-60 focus:ring-4 focus:ring-primary/10"
          >
            {pending ? "Sending code…" : "Create account"}
          </button>
        ) : null}
      </form>
      <a href="/login" className="text-center text-body-sm text-primary">
        I already have an account
      </a>
    </main>
  );
}
