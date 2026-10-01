"use client";
import { clsx } from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";
import { PAYER_NAV_ITEMS } from "./nav-items";

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Payer"
      className="glass fixed inset-x-0 bottom-0 z-30 flex h-16 items-center justify-around border-t border-outline-variant lg:hidden"
    >
      {PAYER_NAV_ITEMS.slice(0, 2).map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} />
      ))}

      <Link
        href="/payer/scan"
        aria-label="Scan to Pay"
        className="-mt-8 flex h-14 w-14 min-h-11 min-w-11 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg shadow-primary/30 focus:outline-none focus:ring-4 focus:ring-primary/10"
      >
        <Icon name="qr_code_scanner" className="text-3xl" />
      </Link>

      {PAYER_NAV_ITEMS.slice(2).map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} />
      ))}
    </nav>
  );
}

function NavLink({ item, pathname }: { item: (typeof PAYER_NAV_ITEMS)[number]; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 text-label-md focus:outline-none focus:ring-4 focus:ring-primary/10",
        active ? "text-primary" : "text-on-surface-variant",
      )}
    >
      <Icon name={item.icon} filled={active} />
      {item.label}
    </Link>
  );
}
