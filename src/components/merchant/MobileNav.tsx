import Link from "next/link";
import { MERCHANT_NAV } from "./SideNav";

export function MobileNav({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Merchant"
      className="glass fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-outline-variant lg:hidden"
    >
      {MERCHANT_NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-label-md ${
              active ? "text-primary" : "text-on-surface-variant"
            }`}
          >
            <span className={`material-symbols-outlined ${active ? "icon-filled" : ""}`}>
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
