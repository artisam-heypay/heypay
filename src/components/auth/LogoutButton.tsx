"use client";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/(auth)/actions";
import { resetAnalytics } from "@/components/analytics/PostHogProvider";

// Logout must be a POST: anchors to a GET /logout get prefetched by browsers and
// extensions (cookies included), silently destroying the session. The form uses
// display:contents so the button styles exactly like the anchor it replaces.
export function LogoutButton({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <form action={logoutAction} onSubmit={resetAnalytics} className="contents">
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}
