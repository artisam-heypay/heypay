import { clsx } from "clsx";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon } from "./Icon";

type Variant = "primary-pill" | "outline-pill" | "secondary-pill" | "onboarding";

const base =
  "inline-flex items-center justify-center gap-stack-sm font-display font-bold rounded-full " +
  "transition-[filter,transform] focus:outline-none focus:ring-4 focus:ring-primary/10 " +
  "disabled:opacity-60 disabled:pointer-events-none min-h-11";

const variants: Record<Variant, string> = {
  "primary-pill":
    "bg-primary text-on-primary text-headline-md shadow-lg shadow-primary/20 hover:brightness-110 active:scale-95",
  "outline-pill":
    "border-2 border-primary text-primary text-body-lg bg-transparent hover:bg-primary/5 active:scale-95",
  "secondary-pill":
    "bg-secondary text-on-secondary text-headline-md hover:brightness-110 active:scale-95",
  onboarding: "bg-secondary text-on-secondary text-body-lg hover:-translate-y-[2px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "md" | "lg";
  trailingIcon?: string;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary-pill",
    size = "lg",
    trailingIcon,
    loading,
    children,
    className,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={clsx(
        base,
        variants[variant],
        size === "lg" ? "px-stack-lg py-4" : "px-stack-md py-3",
        className,
      )}
      {...rest}
    >
      {loading && <Icon name="progress_activity" className="animate-spin" />}
      <span>{children}</span>
      {trailingIcon && !loading && <Icon name={trailingIcon} />}
    </button>
  );
});
