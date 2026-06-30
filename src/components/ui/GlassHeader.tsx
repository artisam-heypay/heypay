import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function GlassHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="glass sticky top-0 z-40 flex h-16 items-center justify-between px-margin-mobile lg:px-margin-desktop">
      <a
        href="/payer/dashboard"
        className="flex items-center gap-stack-sm rounded-lg focus:outline-none focus:ring-4 focus:ring-primary/10"
      >
        <Icon name="account_balance_wallet" filled className="text-3xl text-primary" />
        <span className="font-display text-headline-md font-bold text-primary">HeyPay</span>
      </a>
      <div className="flex items-center gap-stack-md">{children}</div>
    </header>
  );
}
