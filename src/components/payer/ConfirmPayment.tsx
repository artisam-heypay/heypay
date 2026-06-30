"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { dec } from "@/lib/money";
import type { PaymentStatus } from "@/generated/prisma";
import { ConversionBreakdown } from "./ConversionBreakdown";
import { WalletSourceRow } from "./WalletSourceRow";
import { ProcessingOverlay } from "./ProcessingOverlay";

type Props = {
  paymentId: string;
  amountPhp: string;
  quotedRate: string;
  amountXlm: string;
  networkFeeXlm: string;
  quoteExpiresAt: string | null;
  merchantName: string;
  wallet: { publicKey: string; availableXlm: string; approxPhp: string } | null;
};

const TERMINAL = new Set<PaymentStatus>(["SETTLED", "FAILED", "REFUNDED"]);

export function ConfirmPayment(props: Props) {
  const amountPhp = dec(props.amountPhp);
  const quotedRate = dec(props.quotedRate);
  const amountXlm = dec(props.amountXlm);
  const networkFeeXlm = dec(props.networkFeeXlm);
  const total = amountXlm.plus(networkFeeXlm);
  const availableXlm = props.wallet ? dec(props.wallet.availableXlm) : dec("0");
  const insufficient = availableXlm.lessThan(total);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const expiresMs = props.quoteExpiresAt ? new Date(props.quoteExpiresAt).getTime() : 0;
  const expired = expiresMs > 0 && expiresMs < now;
  const secsLeft = expiresMs ? Math.max(0, Math.floor((expiresMs - now) / 1000)) : null;

  const [processing, setProcessing] = useState<PaymentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    },
    [],
  );

  function poll() {
    const tick = async () => {
      try {
        const res = await fetch(`/api/payments/${props.paymentId}`);
        if (res.ok) {
          const { payment } = (await res.json()) as { payment: { status: PaymentStatus } };
          setProcessing(payment.status);
          if (TERMINAL.has(payment.status)) return;
        }
      } catch {
        // transient → keep polling
      }
      pollRef.current = setTimeout(tick, 2000);
    };
    pollRef.current = setTimeout(tick, 2000);
  }

  async function confirm() {
    setError(null);
    try {
      const res = await fetch(`/api/payments/${props.paymentId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: "{}",
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(e?.error?.message ?? "Could not confirm payment.");
      }
      const body = (await res.json()) as { status: PaymentStatus };
      setProcessing(body.status);
      poll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function cancel() {
    try {
      await fetch(`/api/payments/${props.paymentId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
    } catch {
      // ignore — navigate away regardless
    }
    window.location.href = "/payer/dashboard";
  }

  return (
    <div className="flex flex-col gap-stack-lg">
      <ConversionBreakdown
        amountPhp={amountPhp}
        quotedRate={quotedRate}
        amountXlm={amountXlm}
        networkFeeXlm={networkFeeXlm}
      />
      {props.wallet ? (
        <WalletSourceRow
          publicKey={props.wallet.publicKey}
          availableXlm={availableXlm}
          availablePhp={dec(props.wallet.approxPhp)}
          totalXlm={total}
        />
      ) : null}

      {secsLeft !== null && !expired ? (
        <p className="text-center text-body-sm text-on-surface-variant">
          Quote locks for {secsLeft}s
        </p>
      ) : null}
      {expired ? (
        <p role="alert" className="text-center text-body-sm text-error">
          Quote expired — rescan to get a fresh rate.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-center text-body-sm text-error">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-stack-sm">
        <Button
          variant="primary-pill"
          trailingIcon="lock"
          disabled={expired || insufficient}
          onClick={() => void confirm()}
        >
          Confirm &amp; Pay
        </Button>
        <Button variant="outline-pill" onClick={() => void cancel()}>
          Cancel
        </Button>
      </div>

      {processing ? (
        <ProcessingOverlay
          status={processing}
          php={amountPhp.toFixed(2)}
          merchantName={props.merchantName}
        />
      ) : null}
    </div>
  );
}
