import Link from "next/link";
import { clsx } from "clsx";
import { Icon } from "@/components/ui";
import { PAYMENT_STEPS, stepState } from "@/lib/payment-steps";
import type { PaymentStatus } from "@/generated/prisma/client";

export function ProcessingOverlay({
  status,
  merchantName,
  amountPhpDisplay,
  failureReason,
}: {
  status: PaymentStatus;
  merchantName: string;
  amountPhpDisplay: string;
  failureReason?: string | null;
}) {
  const settled = status === "SETTLED";
  const failed = status === "FAILED" || status === "REFUND_PENDING" || status === "REFUNDED";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-stack-lg bg-surface/95 px-margin-mobile backdrop-blur-md"
    >
      {settled ? (
        <>
          <Icon name="check_circle" filled className="text-6xl text-secondary" />
          <h2 className="text-center font-display text-headline-lg text-secondary">
            {amountPhpDisplay} sent to {merchantName}
          </h2>
          <Link
            href="/payer/transactions"
            className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-secondary px-stack-lg py-4 font-display font-bold text-on-secondary focus:outline-none focus:ring-4 focus:ring-primary/10"
          >
            Done
          </Link>
        </>
      ) : failed ? (
        <>
          <Icon name="error" filled className="text-6xl text-error" />
          <h2 className="text-center font-display text-headline-md text-error">
            {status === "REFUNDED" ? "Payment refunded" : "Payment failed"}
          </h2>
          <p className="max-w-sm text-center text-body-md text-on-surface-variant">
            {failureReason ?? "Something went wrong while settling your payment."}
          </p>
          <div className="flex gap-stack-md">
            <Link
              href="/payer/dashboard"
              className="inline-flex min-h-11 items-center rounded-full border-2 border-primary px-stack-lg py-3 font-display font-bold text-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
            >
              Back
            </Link>
            <Link
              href="/payer/scan"
              className="inline-flex min-h-11 items-center rounded-full bg-primary px-stack-lg py-3 font-display font-bold text-on-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
            >
              Try again
            </Link>
          </div>
        </>
      ) : (
        <>
          <div className="relative h-20 w-20">
            <div className="absolute inset-0 animate-spin rounded-full border-4 border-surface-container-high border-t-primary" />
            <div className="absolute inset-2 animate-pulse-ring rounded-full border-2 border-primary/40" />
          </div>
          <h2 className="font-display text-headline-md">Processing payment…</h2>
        </>
      )}

      {!settled && !failed && (
        <ul className="flex w-full max-w-sm flex-col gap-stack-sm">
          {PAYMENT_STEPS.map((step) => {
            const s = stepState(step.key, status);
            return (
              <li key={step.key} className="flex items-center gap-stack-sm">
                <Icon
                  name={
                    s === "done"
                      ? "check_circle"
                      : s === "active"
                        ? "sync"
                        : "radio_button_unchecked"
                  }
                  filled={s === "done"}
                  className={clsx(
                    s === "done" && "text-primary",
                    s === "active" && "animate-pulse text-secondary",
                    s === "todo" && "text-on-surface-variant/50",
                  )}
                />
                <span
                  className={clsx(
                    "text-body-md",
                    s === "todo" ? "text-on-surface-variant/60" : "text-on-surface",
                  )}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
