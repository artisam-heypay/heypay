"use client";
import { useEffect, useRef, useState } from "react";
import { dec, displayPhp } from "@/lib/money";
import { Icon } from "@/components/ui";
import { ConversionBreakdown } from "./ConversionBreakdown";
import { WalletSourceRow } from "./WalletSourceRow";
import { ProcessingOverlay } from "./ProcessingOverlay";
import type { PaymentStatus } from "@/generated/prisma/client";

const TERMINAL = new Set(["SETTLED", "FAILED", "REFUNDED"]);

export function ConfirmPayment(props: {
  paymentId: string;
  amountPhp: string;
  quotedRate: string;
  amountXlm: string;
  networkFeeXlm: string;
  quoteExpiresAt: string | null;
  merchantName: string;
  walletPublicKey: string;
  availableXlm: string;
  approxPhp: string;
}) {
  const amountPhp = dec(props.amountPhp);
  const amountXlm = dec(props.amountXlm);
  const networkFeeXlm = dec(props.networkFeeXlm);
  const requiredXlm = amountXlm.plus(networkFeeXlm);
  const availableXlm = dec(props.availableXlm);

  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<PaymentStatus>("AUTHORIZED");
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollBusyRef = useRef(false);

  const expired = secondsLeft !== null && secondsLeft <= 0;
  const insufficient = availableXlm.lessThan(requiredXlm);

  useEffect(() => {
    if (!props.quoteExpiresAt) return;
    const target = new Date(props.quoteExpiresAt).getTime();
    const tick = () => setSecondsLeft(Math.max(0, Math.floor((target - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [props.quoteExpiresAt]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollBusyRef.current = false;
    };
  }, []);

  async function confirm() {
    setProcessing(true);
    try {
      const res = await fetch(`/api/payments/${props.paymentId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: "{}",
      });
      if (!res.ok) {
        setStatus("FAILED");
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setFailureReason(body?.error?.message ?? "Could not authorize the payment.");
        return;
      }
      const { status: s } = (await res.json()) as { status: PaymentStatus };
      setStatus(s);
      poll();
    } catch {
      setStatus("FAILED");
      setFailureReason("Network error.");
    }
  }

  function poll() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      if (pollBusyRef.current) return;
      pollBusyRef.current = true;
      try {
        const res = await fetch(`/api/payments/${props.paymentId}`);
        if (!res.ok) return;
        const { payment } = (await res.json()) as {
          payment: { status: PaymentStatus; failureReason?: string | null };
        };
        setStatus(payment.status);
        if (payment.failureReason) setFailureReason(payment.failureReason);
        if (TERMINAL.has(payment.status) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        // transient — keep polling
      } finally {
        pollBusyRef.current = false;
      }
    }, 2000);
  }

  async function cancel() {
    await fetch(`/api/payments/${props.paymentId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    }).catch(() => {});
    window.location.href = "/payer/dashboard";
  }

  return (
    <>
      <div className="flex flex-col gap-stack-lg">
        <ConversionBreakdown
          amountPhp={amountPhp}
          quotedRate={dec(props.quotedRate)}
          amountXlm={amountXlm}
          networkFeeXlm={networkFeeXlm}
        />
        <WalletSourceRow
          publicKey={props.walletPublicKey}
          availableXlm={availableXlm}
          approxPhp={dec(props.approxPhp)}
          requiredXlm={requiredXlm}
        />

        {expired && (
          <p role="alert" className="text-body-md text-error">
            Quote expired — rescan to get a fresh rate.
          </p>
        )}
        {secondsLeft !== null && secondsLeft > 0 && (
          <p className="text-body-sm text-on-surface-variant">Rate locked for {secondsLeft}s</p>
        )}

        <div className="flex flex-wrap gap-stack-md">
          <button
            type="button"
            onClick={confirm}
            disabled={expired || insufficient || processing}
            aria-busy={processing || undefined}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-stack-sm rounded-full bg-primary px-stack-lg py-4 font-display font-bold text-on-primary disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-primary/10"
          >
            Confirm
            <Icon name="lock" />
          </button>
          <button
            type="button"
            onClick={cancel}
            className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-primary px-stack-lg py-4 font-display font-bold text-primary hover:bg-primary/5 focus:outline-none focus:ring-4 focus:ring-primary/10"
          >
            Cancel
          </button>
        </div>
      </div>

      {processing && (
        <ProcessingOverlay
          status={status}
          merchantName={props.merchantName}
          amountPhpDisplay={displayPhp(amountPhp)}
          failureReason={failureReason}
        />
      )}
    </>
  );
}
