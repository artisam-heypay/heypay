"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Icon } from "@/components/ui";
import type { SetupState } from "@/server/merchant/service";

export function SetupBanner({ setup }: { setup: SetupState }) {
  const pathname = usePathname();
  // Complete merchants need no banner; the onboarding route renders its own focused shell.
  if (setup.isComplete || pathname.endsWith("/onboarding")) return null;

  const steps = [
    { done: setup.hasBusiness, label: "Business identity" },
    { done: setup.hasSettlement, label: "Settlement account" },
    { done: setup.hasQrph, label: "Link QRPH" },
  ];
  return (
    <div className="mb-stack-lg rounded-xl border border-secondary/30 bg-secondary-container/40 p-stack-lg">
      <div className="flex flex-wrap items-center justify-between gap-stack-md">
        <div>
          <p className="text-headline-md text-on-secondary-container">
            Finish setting up your business
          </p>
          <p className="text-body-sm text-on-surface-variant">
            Complete every step to start accepting payments.
          </p>
        </div>
        <Link
          href="/merchant/onboarding"
          className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-secondary px-stack-lg py-stack-sm text-body-md font-semibold text-on-secondary transition-transform hover:-translate-y-0.5"
        >
          Complete onboarding
          <Icon name="arrow_forward" />
        </Link>
      </div>
      <ul className="mt-stack-md flex flex-wrap gap-stack-md">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-stack-sm text-body-sm">
            <Icon
              name={s.done ? "check_circle" : "radio_button_unchecked"}
              filled={s.done}
              className={clsx(s.done ? "text-primary" : "text-outline")}
            />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
