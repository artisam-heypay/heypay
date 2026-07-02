"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Key = "overview" | "users" | "merchants" | "payments" | "health";

const ITEMS: Array<{ key: Key; label: string; href: string; icon: string }> = [
  { key: "overview", label: "Overview", href: "/admin", icon: "dashboard" },
  { key: "users", label: "Users", href: "/admin/users", icon: "group" },
  { key: "merchants", label: "Merchants", href: "/admin/merchants", icon: "storefront" },
  { key: "payments", label: "Payments", href: "/admin/payments", icon: "payments" },
  { key: "health", label: "Health", href: "/admin/health", icon: "monitor_heart" },
];

export function AdminSideNav({ active }: { active?: Key }) {
  const pathname = usePathname();
  const derived: Key =
    active ??
    (pathname === "/admin"
      ? "overview"
      : (ITEMS.find((i) => i.href !== "/admin" && pathname?.startsWith(i.href))?.key ??
        "overview"));

  return (
    <nav
      aria-label="Admin"
      className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-surface-container-low p-stack-md lg:flex"
    >
      <div className="flex items-center gap-stack-sm px-stack-sm py-stack-md">
        <span className="material-symbols-outlined icon-filled text-primary">
          account_balance_wallet
        </span>
        <span className="font-display text-headline-md font-bold text-primary">HeyPay</span>
        <span className="ml-stack-sm rounded-lg bg-surface-container-high px-2 py-0.5 text-label-md uppercase text-on-surface-variant">
          Admin
        </span>
      </div>
      <ul className="mt-stack-md flex flex-1 flex-col gap-1">
        {ITEMS.map((item) => {
          const isActive = item.key === derived;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-stack-md rounded-lg px-stack-md py-3 text-body-md transition-colors ${
                  isActive
                    ? "bg-primary-container font-semibold text-on-primary-container"
                    : "text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                <span className={`material-symbols-outlined ${isActive ? "icon-filled" : ""}`}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        href="/logout"
        className="mt-stack-md flex items-center gap-stack-md rounded-lg px-stack-md py-3 text-body-md text-error hover:bg-surface-container-high"
      >
        <span className="material-symbols-outlined">logout</span>
        Logout
      </Link>
    </nav>
  );
}
