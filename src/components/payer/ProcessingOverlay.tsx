import { clsx } from "clsx";
import Link from "next/link";
import { Button, Icon } from "@/components/ui";
import { PAYMENT_STEPS, stepState } from "@/lib/payment-steps";
import type { PaymentStatus } from "@/generated/prisma";

export function ProcessingOverlay({
  status,
  php,
  merchantName,
  failureReason,
}: {
  status: PaymentStatus;
  php: string;
  merchantName: string;
  failureReason?: string | null;
}) {
  const settled = status === "SETTLED";
  const failed = status === "FAILED" || status === "REFUND_PENDING" || status === "REFUNDED";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-stack-lg bg-background/95 p-margin-mobile text-center backdrop-blur-md"
    >
      {settled ? (
        <>
          <Icon name="check_circle" filled className="text-6xl text-secondary" />
          <h2 className="text-headline-lg font-display font-bold text-secondary">
            ₱{php} sent to {merchantName}
          </h2>
          <Link href="/payer/transactions">
            <Button variant="secondary-pill" trailingIcon="check">
              Done
            </Button>
          </Link>
        </>
      ) : failed ? (
        <>
          <Icon name="error" className="text-6xl text-error" />
          <h2 className="text-headline-md font-display text-error">
            Payment {status === "FAILED" ? "failed" : "refunded"}
          </h2>
          <p className="max-w-sm text-body-sm text-on-surface-variant">
            {failureReason ?? "Something went wrong. Your XLM is safe."}
          </p>
          <Link href="/payer/dashboard">
            <Button variant="outline-pill">Back to dashboard</Button>
          </Link>
        </>
      ) : (
        <>
          <div className="relative h-16 w-16">
            <div className="absolute inset-0 rounded-full border-t-4 border-primary animate-spin" />
            <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-pulse-ring" />
          </div>
          <ul className="flex flex-col gap-stack-sm text-left">
            {PAYMENT_STEPS.map((s) => {
              const st = stepState(s.key, status);
              return (
                <li key={s.key} className="flex items-center gap-stack-sm">
                  <Icon
                    name={
                      st === "done"
                        ? "check_circle"
                        : st === "active"
                          ? "sync"
                          : "radio_button_unchecked"
                    }
                    filled={st === "done"}
                    className={clsx(
                      st === "done" && "text-primary",
                      st === "active" && "text-secondary animate-pulse",
                      st === "todo" && "text-on-surface-variant",
                    )}
                  />
                  <span className={st === "todo" ? "text-on-surface-variant" : ""}>{s.label}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
