import Link from "next/link";

export const MERCHANT_NAV = [
  { href: "/merchant/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/merchant/transactions", label: "Transactions", icon: "history" },
  { href: "/merchant/qr", label: "My QR", icon: "qr_code_2" },
  { href: "/merchant/settings", label: "Settings", icon: "settings" },
] as const;

export function SideNav({ businessName, pathname }: { businessName: string; pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-outline-variant bg-surface-container-low p-stack-lg lg:flex">
      <div className="mb-stack-lg flex items-center gap-stack-sm">
        <span className="material-symbols-outlined icon-filled text-primary">
          account_balance_wallet
        </span>
        <span className="text-headline-md font-bold text-primary">HeyPay</span>
      </div>
      <div className="mb-stack-lg rounded-lg bg-surface-container p-stack-md">
        <p className="text-label-md uppercase text-on-surface-variant">Business</p>
        <p className="truncate text-body-md font-medium text-on-surface">{businessName}</p>
      </div>
      <nav className="flex flex-1 flex-col gap-stack-sm" aria-label="Merchant">
        {MERCHANT_NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center gap-stack-md rounded-lg px-stack-md py-stack-sm text-body-md transition-colors ${
                active
                  ? "bg-primary-container font-semibold text-on-primary-container"
                  : "text-on-surface-variant hover:bg-surface-container-high"
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
      <div className="mt-stack-lg flex flex-col gap-stack-sm border-t border-outline-variant pt-stack-md">
        <Link
          href="/merchant/settings"
          className="flex min-h-11 items-center gap-stack-md px-stack-md py-stack-sm text-body-md text-on-surface-variant hover:bg-surface-container-high"
        >
          <span className="material-symbols-outlined">support_agent</span>Support
        </Link>
        <a
          href="/logout"
          className="flex min-h-11 w-full items-center gap-stack-md px-stack-md py-stack-sm text-body-md text-error hover:bg-surface-container-high"
        >
          <span className="material-symbols-outlined">logout</span>Log out
        </a>
      </div>
    </aside>
  );
}
