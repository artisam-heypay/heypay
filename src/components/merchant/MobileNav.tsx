"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Icon } from "@/components/ui";
import { MERCHANT_NAV_ITEMS } from "./nav-items";

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Merchant"
      className="glass fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around lg:hidden"
    >
      {MERCHANT_NAV_ITEMS.map((item) => {
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
    </nav>
  );
}
