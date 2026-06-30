"use client";
import { forwardRef } from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & { label: string; id: string };

export const FloatingInput = forwardRef<HTMLInputElement, Props>(function FloatingInput(
  { label, id, className = "", ...rest },
  ref,
) {
  return (
    <div className="relative">
      <input
        id={id}
        ref={ref}
        placeholder=" "
        className={`peer w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-4 pb-2 pt-6 text-body-md text-on-surface placeholder-transparent focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 ${className}`}
        {...rest}
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-4 top-2 text-label-md uppercase tracking-wide text-on-surface-variant transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-body-md peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-focus:top-2 peer-focus:text-label-md peer-focus:uppercase peer-focus:tracking-wide peer-focus:text-primary"
      >
        {label}
      </label>
    </div>
  );
});
