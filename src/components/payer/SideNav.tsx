"use client";
import { clsx } from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";
import { PAYER_NAV_ITEMS } from "./nav-items";

export function SideNav({ username }: { username: string }) {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-surface-container-low px-stack-md py-stack-lg lg:flex">
      <Link
        href="/payer/dashboard"
        className="mb-stack-lg flex items-center gap-stack-sm rounded-lg px-stack-sm focus:outline-none focus:ring-4 focus:ring-primary/10"
      >
        <Icon name="account_balance_wallet" filled className="text-3xl text-primary" />
        <span className="font-display text-headline-md font-bold text-primary">HeyPay</span>
      </Link>

      <Link
        href="/payer/scan"
        className="mb-stack-lg inline-flex min-h-11 items-center justify-center gap-stack-sm rounded-full bg-primary px-stack-lg py-3 font-display font-bold text-on-primary shadow-lg shadow-primary/20 transition-[filter] hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-primary/10"
      >
        Scan to Pay
        <Icon name="qr_code_scanner" />
      </Link>

      <nav className="flex flex-1 flex-col gap-stack-sm" aria-label="Payer">
        {PAYER_NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex min-h-11 items-center gap-stack-md rounded-lg px-stack-md py-2 text-body-md focus:outline-none focus:ring-4 focus:ring-primary/10",
                active
                  ? "bg-primary-container font-bold text-on-primary-container"
                  : "text-on-surface-variant hover:bg-surface-container-high",
              )}
            >
              <Icon name={item.icon} filled={active} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-stack-lg flex flex-col gap-stack-sm border-t border-outline-variant pt-stack-md">
        <span className="px-stack-md text-label-md uppercase text-on-surface-variant">
          {username}
        </span>
        <a
          href="/support"
          className="flex min-h-11 items-center gap-stack-md rounded-lg px-stack-md py-2 text-body-md text-on-surface-variant hover:bg-surface-container-high focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          <Icon name="support_agent" />
          Support
        </a>
        <a
          href="/logout"
          className="flex min-h-11 items-center gap-stack-md rounded-lg px-stack-md py-2 text-body-md text-error hover:bg-error/5 focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          <Icon name="logout" />
          Logout
        </a>
      </div>
    </aside>
  );
}
