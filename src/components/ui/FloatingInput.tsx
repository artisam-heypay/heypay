"use client";
import { forwardRef } from "react";
import { clsx } from "clsx";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  /** What is wrong with the value, shown under the field. */
  error?: string | null;
};

export const FloatingInput = forwardRef<HTMLInputElement, Props>(function FloatingInput(
  { label, id, className = "", error, ...rest },
  ref,
) {
  const errorId = `${id}-error`;
  return (
    <div className="relative">
      <input
        id={id}
        ref={ref}
        placeholder=" "
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={clsx(
          "peer w-full rounded-lg border bg-surface-container-lowest px-4 pb-2 pt-6 text-body-md text-on-surface placeholder-transparent focus:outline-none focus:ring-2",
          error
            ? "border-error focus:border-error focus:ring-error"
            : "border-outline-variant focus:border-focus focus:ring-focus",
          className,
        )}
        {...rest}
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-4 top-2 text-label-md uppercase tracking-wide text-on-surface-variant transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-body-md peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-focus:top-2 peer-focus:text-label-md peer-focus:uppercase peer-focus:tracking-wide peer-focus:text-focus"
      >
        {label}
      </label>
      {error && (
        <p id={errorId} className="mt-1 flex items-start gap-1 text-body-sm text-error">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            error
          </span>
          {error}
        </p>
      )}
    </div>
  );
});
