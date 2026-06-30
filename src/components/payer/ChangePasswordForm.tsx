"use client";
import { useState, type FormEvent } from "react";
import { Button, Card } from "@/components/ui";

function Field({
  id,
  label,
  autoComplete,
  value,
  onChange,
}: {
  id: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        name={id}
        type="password"
        autoComplete={autoComplete}
        required
        placeholder=" "
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="peer w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-4 pb-2 pt-6 text-body-md text-on-surface outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-4 top-4 text-on-surface-variant transition-all peer-focus:top-2 peer-focus:text-label-md peer-focus:text-primary peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-label-md"
      >
        {label}
      </label>
    </div>
  );
}

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation don't match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
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
      setError(body?.error?.message ?? "Could not update your password.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <h2 className="text-headline-md font-display">Change Password</h2>
      <form onSubmit={submit} className="mt-stack-md flex flex-col gap-gutter">
        <Field
          id="currentPassword"
          label="Current password"
          autoComplete="current-password"
          value={current}
          onChange={setCurrent}
        />
        <Field
          id="newPassword"
          label="New password"
          autoComplete="new-password"
          value={next}
          onChange={setNext}
        />
        <Field
          id="confirmPassword"
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
        />
        <p className="text-body-sm text-on-surface-variant">At least 8 characters.</p>
        {error ? (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        ) : null}
        <p aria-live="polite" className="min-h-[1.25rem] text-body-sm text-primary">
          {success ? "Password updated." : ""}
        </p>
        <Button type="submit" variant="primary-pill" trailingIcon="lock" loading={loading}>
          Update password
        </Button>
      </form>
    </Card>
  );
}
