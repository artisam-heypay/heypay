"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Button, Icon } from "@/components/ui";
import { PAYER_NAV_ITEMS } from "./nav-items";

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function SideNav({ username }: { username: string }) {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-surface-container-low p-stack-lg lg:flex">
      <div className="flex items-center gap-stack-sm">
        <Icon name="account_balance_wallet" filled className="text-3xl text-primary" />
        <span className="font-display text-headline-md font-bold text-primary">HeyPay</span>
      </div>

      <Link href="/payer/scan" className="mt-stack-lg block">
        <Button variant="primary-pill" trailingIcon="qr_code_scanner" className="w-full">
          Scan to Pay
        </Button>
      </Link>

      <nav aria-label="Primary" className="mt-stack-lg flex flex-col gap-stack-sm">
        {PAYER_NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex min-h-11 items-center gap-stack-sm rounded-lg px-4 focus:outline-none focus:ring-4 focus:ring-primary/10",
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

      <div className="mt-auto flex flex-col gap-stack-sm">
        <span className="px-4 text-label-md text-on-surface-variant">@{username}</span>
        <a
          href="/support"
          className="flex min-h-11 items-center gap-stack-sm rounded-lg px-4 text-on-surface-variant hover:bg-surface-container-high"
        >
          <Icon name="support_agent" />
          Support
        </a>
        <a
          href="/logout"
          className="flex min-h-11 items-center gap-stack-sm rounded-lg px-4 text-error hover:bg-error/5"
        >
          <Icon name="logout" />
          Logout
        </a>
      </div>
    </aside>
  );
}
