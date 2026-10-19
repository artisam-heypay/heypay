import Link from "next/link";
import type { ReactNode } from "react";
import { dec, Decimal } from "@/lib/money";
import { formatDayTime } from "@/lib/dates";
import { Icon } from "@/components/ui";

/** What the settled screen shows as proof, read from the payment once it settles. */
export type PaymentReceipt = {
  reference: string;
  settledAt: string | null;
  asset: string;
  amountAsset: string;
  stellarTxUrl: string | null;
};

/** "17.1428572" -> "17.1429": the crypto side of a peso receipt, to four places. */
function roughly(amount: string): string {
  return dec(amount).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
}

/**
 * The end of a payment: a paper receipt prints out of a slot and is stamped
 * PAID, made to be turned toward the cashier. The motion runs once on arrival;
 * under reduced motion the receipt is simply there, already stamped.
 */
export function SettledReceipt({
  amountPhpDisplay,
  merchantName,
  receipt,
  onDismiss,
}: {
  amountPhpDisplay: string;
  merchantName: string;
  /** Null until the payment's details are read; the receipt shows without them. */
  receipt: PaymentReceipt | null;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex w-full max-w-[22rem] flex-col items-center gap-stack-lg">
      {/* Roughens the stamp's edges like ink on paper. */}
      <svg aria-hidden width="0" height="0" className="absolute">
        <filter id="heypay-stamp-ink">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="2.4" />
        </filter>
      </svg>

      <div className="relative w-full pt-[7px]">
        {/* The printer's slot the receipt comes out of. */}
        <div
          aria-hidden
          className="absolute -inset-x-3 top-0 z-10 h-3.5 rounded-full bg-[#0b0a09] shadow-[inset_0_3px_4px_rgba(0,0,0,0.9)] ring-1 ring-white/15"
        />
        <div className="-mx-3 overflow-hidden px-3 pb-10">
          <div className="animate-receipt-print">
            <div className="drop-shadow-[0_18px_22px_rgba(0,0,0,0.45)]">
              <article className="receipt-paper animate-receipt-thud relative bg-[#fffefb] px-stack-lg pb-stack-lg pt-margin-mobile text-on-surface">
                <div className="flex items-center justify-between gap-stack-sm text-body-sm text-on-surface-variant">
                  <span className="flex items-center gap-1.5 font-display font-bold text-primary-ink">
                    <Icon name="account_balance_wallet" filled className="text-[20px]" />
                    HeyPay
                  </span>
                  {receipt?.settledAt && (
                    <time dateTime={receipt.settledAt} className="tabular-nums">
                      {formatDayTime(receipt.settledAt)}
                    </time>
                  )}
                </div>

                <h2 className="mt-margin-desktop flex flex-col">
                  <span className="font-display text-[2.75rem] font-bold leading-none tracking-[-0.02em] tabular-nums">
                    {amountPhpDisplay}
                  </span>{" "}
                  <span className="mt-stack-sm text-body-lg text-on-surface-variant">
                    sent to <span className="font-semibold text-on-surface">{merchantName}</span>
                  </span>
                </h2>

                <div className="my-stack-lg border-t-2 border-dashed border-outline-variant" />

                {receipt ? (
                  <dl className="flex flex-col gap-stack-sm text-body-sm">
                    <Row label="Reference">
                      <span className="font-mono tracking-wide">{receipt.reference}</span>
                    </Row>
                    <Row label="Paid with">
                      ≈ {roughly(receipt.amountAsset)} {receipt.asset}
                    </Row>
                    {receipt.stellarTxUrl && (
                      <Row label="On Stellar">
                        <a
                          href={receipt.stellarTxUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-6 items-center gap-1 font-medium text-primary-ink"
                        >
                          <span className="underline underline-offset-2">View transaction</span>
                          <Icon name="open_in_new" className="text-[16px]" />
                        </a>
                      </Row>
                    )}
                  </dl>
                ) : (
                  <p className="text-body-sm text-on-surface-variant">Getting the details…</p>
                )}

                {/* Stamped in its own space, so it never covers the amount a
                    cashier reads. */}
                <div className="mt-stack-md flex justify-end">
                  <div
                    aria-hidden
                    className="animate-stamp-in pointer-events-none -rotate-[10deg] rounded-md border-[3px] border-primary-ink p-[3px] text-primary-ink opacity-90 mix-blend-multiply [filter:url(#heypay-stamp-ink)]"
                  >
                    <span className="flex items-center gap-1 rounded-[3px] border border-primary-ink px-2 py-0.5 font-display text-[1.6rem] font-bold uppercase leading-none tracking-[0.14em]">
                      <Icon name="check" className="text-[1.4rem]" />
                      Paid
                    </span>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </div>
      </div>

      <p className="-mt-stack-lg text-center text-body-md text-white/80">
        Show this screen to the cashier.
      </p>
      <Link
        href="/payer/transactions"
        onClick={onDismiss}
        autoFocus
        className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-primary px-margin-desktop py-4 font-display text-body-lg font-bold text-on-primary-container shadow-lg shadow-black/30 transition-[filter] hover:brightness-110"
      >
        Done
      </Link>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-stack-md">
      <dt className="shrink-0 text-on-surface-variant">{label}</dt>
      <dd className="min-w-0 text-right text-on-surface [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
