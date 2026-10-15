"use client";
import Link from "next/link";
import { Button } from "@/components/ui";
import type { RefusedRequest } from "@/lib/payment-refusal";
import { TurnOnAsset } from "./TurnOnAsset";

const linkClass = "rounded underline focus:outline-none focus:ring-4 focus:ring-primary/10";

/**
 * A refused payment on the confirm screen: what went wrong, then the one thing
 * the payer can do about it. A failure that is not a known refusal shows its
 * message alone.
 */
export function PaymentRefusalNotice({
  refused,
  currentAsset,
  busy,
  onPayWith,
}: {
  refused: RefusedRequest;
  /** The asset of the payment on screen. */
  currentAsset: string;
  busy?: boolean;
  /** Re-quotes the payment in `asset`. */
  onPayWith: (asset: string) => void;
}) {
  const { message, refusal } = refused;
  // Offered only when it would change something: not for the asset already chosen.
  const payWith = refusal?.payWith && refusal.payWith !== currentAsset ? refusal.payWith : null;
  const short =
    refusal?.reason === "insufficient_balance" || refusal?.reason === "insufficient_fee";
  const topUp = refusal?.reason === "insufficient_fee" ? "XLM" : refusal?.asset;

  return (
    <div className="flex flex-col gap-stack-md">
      <p role="alert" className="text-body-md text-error">
        {message}
      </p>
      {refusal?.reason === "payer_no_trustline" && (
        // Once it is on, the payment is quoted again in that asset.
        <TurnOnAsset asset={refusal.asset} on={false} onTurnedOn={() => onPayWith(refusal.asset)} />
      )}
      {(short || payWith) && (
        <div className="flex flex-wrap items-center gap-stack-md">
          {short && (
            <Link href="/payer/prefund" className={linkClass}>
              Add {topUp}
            </Link>
          )}
          {payWith && (
            <Button
              type="button"
              size="md"
              variant="outline-pill"
              disabled={busy}
              onClick={() => onPayWith(payWith)}
            >
              Pay with {payWith}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
