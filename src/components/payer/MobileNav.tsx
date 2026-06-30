"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Icon } from "@/components/ui";
import { PAYER_NAV_ITEMS } from "./nav-items";

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around lg:hidden"
    >
      {PAYER_NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 text-label-md",
              active ? "text-primary" : "text-on-surface-variant",
            )}
          >
            <Icon name={item.icon} filled={active} />
            {item.label}
          </Link>
        );
      })}
      <Link
        href="/payer/scan"
        aria-label="Scan to Pay"
        className="absolute -top-6 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg shadow-primary/30"
      >
        <Icon name="qr_code_scanner" />
      </Link>
    </nav>
  );
}
