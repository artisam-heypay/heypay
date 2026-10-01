"use client";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FloatingInput } from "@/components/auth/FloatingInput";
import { Button } from "@/components/ui";

export function ChangePasswordForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Choose a password different from your current one.");
      return;
    }

    setError(null);
    start(async () => {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.status === 204) {
        // The API revoked every session and issued a fresh cookie for this device; refresh
        // so the admin gate re-reads the new auth.password.change audit row.
        router.replace("/admin");
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Could not change your password. Please try again.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-gutter">
      <FloatingInput
        id="currentPassword"
        name="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FloatingInput
        id="newPassword"
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
      />
      <FloatingInput
        id="confirmPassword"
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
      />
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
