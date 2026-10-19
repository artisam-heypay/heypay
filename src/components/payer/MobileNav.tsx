"use client";
import { clsx } from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";
import { PAYER_NAV_ITEMS } from "./nav-items";

// The confirm step has its own Pay and Cancel buttons at the bottom; the bar's
// scan button would sit just under them.
const HIDDEN_ON = /^\/payer\/pay\/[^/]+\/confirm$/;

export function MobileNav() {
  const pathname = usePathname();
  if (HIDDEN_ON.test(pathname)) return null;
  return (
    <nav
      aria-label="Payer"
      className="fixed inset-x-0 bottom-0 bg-surface-container-lowest shadow-[0_-4px_16px_rgba(0,0,0,0.06)] z-30 flex h-16 items-center justify-around border-t border-outline-variant lg:hidden"
    >
      {PAYER_NAV_ITEMS.slice(0, 2).map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} />
      ))}

      <Link
        href="/payer/scan"
        aria-label="Scan to Pay"
        className="-mt-8 flex h-14 w-14 min-h-11 min-w-11 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg shadow-primary/30"
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
        "flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 text-label-md",
        active ? "text-primary" : "text-on-surface-variant",
      )}
    >
      <Icon name={item.icon} filled={active} />
      {item.label}
    </Link>
  );
}
