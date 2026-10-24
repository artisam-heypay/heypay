import Link from "next/link";
import { clsx } from "clsx";
import { Icon } from "@/components/ui";
import { HeyPayLogo } from "@/components/ui/HeyPayLogo";
import { PAYMENT_STEPS, stepState } from "@/lib/payment-steps";
import type { PaymentStatus } from "@/generated/prisma/client";

/** The result screen's heading for a payment that did not reach the merchant. */
const NOT_PAID_HEADING: Partial<Record<PaymentStatus, string>> = {
  FAILED: "Payment didn't go through",
  REFUND_PENDING: "Payment didn't go through",
  REFUNDED: "Payment refunded",
  CANCELLED: "Payment cancelled",
};

export function ProcessingOverlay({
  status,
  merchantName,
  amountPhpDisplay,
  failureReason,
  bankRefused = false,
}: {
  status: PaymentStatus;
  merchantName: string;
  amountPhpDisplay: string;
  /**
   * Why the payment could not be confirmed, written for the payer. Server-side
   * failure reasons are meant for admins and are not passed here.
   */
  failureReason?: string | null;
  /** The shop's bank refused the payout, which is why the shop was not paid. */
  bankRefused?: boolean;
}) {
  const settled = status === "SETTLED";
  const failed = NOT_PAID_HEADING[status] !== undefined;
  // Paying again before the last payment's money is back would spend money the
  // payer does not have yet.
  const refunding = status === "REFUND_PENDING";
  // The money is back: the shop was not paid, but nothing is wrong for the payer.
  const refunded = status === "REFUNDED";
  const notPaid = bankRefused
    ? `We couldn't pay ${merchantName}: their bank didn't accept the transfer.`
    : `We couldn't pay ${merchantName}.`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-stack-lg bg-surface/95 px-margin-mobile backdrop-blur-md"
    >
      {settled ? (
        <>
          {/* The HeyPay mark with a check on its corner. */}
          <span className="relative">
            <HeyPayLogo size={88} className="drop-shadow-[0_10px_18px_rgba(29,27,26,0.14)]" />
            <span className="absolute -bottom-2 -right-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary-ink text-white ring-4 ring-surface">
              <Icon name="check" className="text-[22px]" />
            </span>
          </span>
          <h2 className="flex max-w-md flex-col items-center gap-1 text-center">
            <span className="font-display text-[2.5rem] font-bold leading-tight tracking-[-0.02em] text-on-surface tabular-nums">
              {amountPhpDisplay}
            </span>{" "}
            <span className="text-body-lg text-on-surface-variant">
              sent to <span className="font-semibold text-on-surface">{merchantName}</span>
            </span>
          </h2>
          <Link
            href="/payer/transactions"
            className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-primary px-margin-desktop py-4 font-display text-body-lg font-bold text-on-primary-container shadow-lg shadow-primary/20 transition-[filter] hover:brightness-110"
          >
            Done
          </Link>
        </>
      ) : failed ? (
        <>
          <Icon
            name={refunded ? "undo" : "error"}
            filled={!refunded}
            className={clsx("text-6xl", refunded ? "text-primary" : "text-error")}
          />
          <h2
            className={clsx(
              "text-center font-display text-headline-md",
              refunded ? "text-on-surface" : "text-error",
            )}
          >
            {NOT_PAID_HEADING[status]}
          </h2>
          <p className="max-w-sm text-center text-body-md text-on-surface-variant">
            {status === "CANCELLED"
              ? `You cancelled this payment. Nothing was sent to ${merchantName}.`
              : status === "FAILED"
                ? (failureReason ?? notPaid)
                : notPaid}
          </p>
          {refunding ? (
            <p className="max-w-sm text-center text-body-md font-bold text-on-surface">
              Your {amountPhpDisplay} is being returned to your wallet.
            </p>
          ) : refunded ? (
            <p className="max-w-sm text-center text-body-md font-bold text-on-surface">
              Your {amountPhpDisplay} is back in your wallet.
            </p>
          ) : null}
          <div className="flex gap-stack-md">
            <Link
              href="/payer/dashboard"
              className="inline-flex min-h-11 items-center rounded-full border-2 border-primary px-stack-lg py-3 font-display font-bold text-primary"
            >
              Back
            </Link>
            {!refunding && (
              <Link
                href="/payer/scan"
                className="inline-flex min-h-11 items-center rounded-full bg-primary px-stack-lg py-3 font-display font-bold text-on-primary"
              >
                Pay again
              </Link>
            )}
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
