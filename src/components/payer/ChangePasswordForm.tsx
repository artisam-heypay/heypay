"use client";
import { useState } from "react";
import { Card, Icon } from "@/components/ui";

const MIN_LEN = 8;

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (next.length < MIN_LEN) {
      setError(`New password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json", origin: window.location.origin },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (res.status === 204) {
        setSuccess(true);
        setCurrent("");
        setNext("");
        setConfirm("");
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "Could not update password.");
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="font-display text-headline-md">Change Password</h2>
      <form onSubmit={submit} className="mt-stack-md flex flex-col gap-stack-md">
        <Field
          id="current-password"
          label="Current password"
          autoComplete="current-password"
          value={current}
          onChange={setCurrent}
        />
        <Field
          id="new-password"
          label="New password"
          autoComplete="new-password"
          value={next}
          onChange={setNext}
        />
        <Field
          id="confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
        />
        <p className="text-body-sm text-on-surface-variant">At least {MIN_LEN} characters.</p>

        {error && (
          <p role="alert" aria-live="polite" className="text-body-sm text-error">
            {error}
          </p>
        )}
        {success && (
          <p aria-live="polite" className="text-body-sm text-primary">
            Password updated.
          </p>
        )}

        <button
          type="submit"
          aria-busy={busy || undefined}
          disabled={busy}
          className="inline-flex min-h-11 items-center justify-center gap-stack-sm rounded-full bg-primary px-stack-lg py-4 font-display font-bold text-on-primary disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          Update password
          <Icon name="lock" />
        </button>
      </form>
    </Card>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  return (
    <div className="flex flex-col gap-stack-sm">
      <label htmlFor={id} className="text-body-sm text-on-surface-variant">
        {label}
      </label>
      <input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-3 focus:outline-none focus:ring-4 focus:ring-primary/10"
      />
    </div>
  );
}
