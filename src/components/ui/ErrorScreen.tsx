import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * A whole page for a request that leads nowhere (404, 403): says what happened
 * in plain words and always offers a way back.
 */
export function ErrorScreen({
  code,
  icon,
  title,
  children,
  home,
  extra,
}: {
  code: 403 | 404;
  icon: string;
  title: string;
  children: ReactNode;
  /** Where the main button goes, and what it says. */
  home: { href: string; label: string };
  /** A second, quieter way out. */
  extra?: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-stack-lg p-margin-mobile">
      <Link href="/" className="flex items-center gap-stack-sm self-start rounded-lg">
        <Icon name="account_balance_wallet" filled className="text-3xl text-primary" />
        <span className="font-display text-headline-md font-bold text-primary">HeyPay</span>
      </Link>
      <div className="tonal-card flex flex-col gap-stack-md rounded-xl p-margin-mobile lg:p-margin-desktop">
        <Icon name={icon} className="text-5xl text-primary" />
        <p className="text-label-md uppercase text-on-surface-variant">Error {code}</p>
        <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">{title}</h1>
        <p className="text-body-md text-on-surface-variant">{children}</p>
        <div className="mt-stack-sm flex flex-wrap items-center gap-stack-md">
          <Link
            href={home.href}
            className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-primary px-stack-lg py-3 font-display font-bold text-on-primary shadow-lg shadow-primary/20"
          >
            {home.label}
            <Icon name="arrow_forward" />
          </Link>
          {extra}
        </div>
      </div>
    </main>
  );
}
