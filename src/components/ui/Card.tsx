import { clsx } from "clsx";
import type { ElementType, ReactNode } from "react";

export function Card({
  as: As = "div",
  className,
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <As className={clsx("rounded-xl bg-surface-container-lowest p-stack-lg", className)}>
      {children}
    </As>
  );
}

// Cyan-tinted elevation per BRAND §5 via the `.tonal-card` component utility in globals.css.
export function TonalCard({
  as: As = "div",
  className,
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return <As className={clsx("tonal-card rounded-xl p-stack-lg", className)}>{children}</As>;
}
