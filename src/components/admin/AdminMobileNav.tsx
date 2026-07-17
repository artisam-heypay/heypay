"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV, activeAdminKey } from "./AdminSideNav";
import { LogoutButton } from "@/components/auth/LogoutButton";

// The sidebar is lg-only, so on a phone the admin console had no navigation and no way
// to log out. This is the mobile counterpart: a top bar carrying logout (the sidebar's
// only home for it) and a bottom tab bar for the sections.
export function AdminMobileNav() {
  const active = activeAdminKey(usePathname());

  return (
    <>
      <header className="glass sticky top-0 z-40 flex h-16 items-center justify-between gap-stack-sm px-margin-mobile lg:hidden">
        <span className="flex min-w-0 items-center gap-stack-sm">
          <span className="material-symbols-outlined icon-filled text-primary" aria-hidden="true">
            account_balance_wallet
          </span>
          <span className="font-display text-headline-md font-bold text-primary">HeyPay</span>
          <span className="rounded-lg bg-surface-container-high px-2 py-0.5 text-label-md uppercase text-on-surface-variant">
            Admin
          </span>
        </span>
        <LogoutButton className="flex min-h-11 shrink-0 items-center gap-stack-sm rounded-lg px-stack-sm text-body-md text-error hover:bg-surface-container-high focus:outline-none focus:ring-4 focus:ring-primary/10">
          <span className="material-symbols-outlined" aria-hidden="true">
            logout
          </span>
          Log out
        </LogoutButton>
      </header>

      <nav
        aria-label="Admin"
        className="glass fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-outline-variant lg:hidden"
      >
        {ADMIN_NAV.map((item) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-label-md ${
                isActive ? "text-primary" : "text-on-surface-variant"
              }`}
            >
              <span
                className={`material-symbols-outlined ${isActive ? "icon-filled" : ""}`}
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <span className="w-full truncate text-center">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
