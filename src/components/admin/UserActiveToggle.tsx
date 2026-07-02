"use client";
import { useState, useTransition } from "react";

export function UserActiveToggle({
  id,
  isActive,
  username,
}: {
  id: string;
  isActive: boolean;
  username: string;
}) {
  const [active, setActive] = useState(isActive);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    start(async () => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !active }),
      });
      if (!res.ok) {
        setError("Update failed");
        return;
      }
      const body = await res.json();
      setActive(body.isActive);
    });
  }

  return (
    <div className="flex items-center gap-stack-sm">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={`${active ? "Deactivate" : "Activate"} ${username}`}
        className={`rounded-lg px-stack-md py-2 text-label-md uppercase disabled:opacity-50 ${
          active
            ? "bg-error/10 text-error hover:bg-error/20"
            : "bg-primary/10 text-primary hover:bg-primary/20"
        }`}
      >
        {active ? "Deactivate" : "Activate"}
      </button>
      {error ? (
        <span className="text-body-sm text-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
