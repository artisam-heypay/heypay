"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dec, displayPhp } from "@/lib/money";
import { Icon } from "@/components/ui";
import { AssetPicker } from "./AssetPicker";
import { ConversionBreakdown } from "./ConversionBreakdown";
import { WalletSourceRow } from "./WalletSourceRow";
import { ProcessingOverlay } from "./ProcessingOverlay";
import type { PaymentStatus } from "@/generated/prisma/client";

const TERMINAL = new Set(["SETTLED", "FAILED", "REFUNDED"]);

export type ConfirmAssetOption = { asset: string; available: string; canReceive: boolean };

export function ConfirmPayment(props: {
  paymentId: string;
  merchantId: string;
  asset: string;
  assetOptions: ConfirmAssetOption[];
  amountPhp: string;
  quotedRate: string;
  amountAsset: string;
  networkFeeXlm: string;
  quoteExpiresAt: string | null;
  merchantName: string;
  walletPublicKey: string;
  availableAsset: string;
  approxPhp: string;
}) {
  const router = useRouter();
  const amountPhp = dec(props.amountPhp);
  const amountAsset = dec(props.amountAsset);
  const networkFeeXlm = dec(props.networkFeeXlm);
  const availableAsset = dec(props.availableAsset);
  // A Stellar fee is always paid in XLM. When XLM funds the payment it comes out
  // of the same balance as the amount; otherwise it is a separate XLM debit.
  const isXlm = props.asset === "XLM";
  const requiredAsset = isXlm ? amountAsset.plus(networkFeeXlm) : amountAsset;

  const [processing, setProcessing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [status, setStatus] = useState<PaymentStatus>("AUTHORIZED");
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollBusyRef = useRef(false);

  const expired = secondsLeft !== null && secondsLeft <= 0;
  const insufficient = availableAsset.lessThan(requiredAsset);

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

  /**
   * A quote locks one asset's rate, so picking a different asset means cancelling
   * this payment and quoting a fresh one rather than mutating it in place.
   */
  async function switchAsset(asset: string) {
    if (asset === props.asset || switching) return;
    setSwitching(true);
    setFailureReason(null);
    try {
      const res = await fetch("/api/payments/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          merchantId: props.merchantId,
          amountPhp: props.amountPhp,
          asset,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setFailureReason(body?.error?.message ?? `Could not quote in ${asset}.`);
        return;
      }
      const { paymentId } = (await res.json()) as { paymentId: string };
      // Release the superseded quote's reservation; the new one already holds funds.
      await fetch(`/api/payments/${props.paymentId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      }).catch(() => {});
      router.replace(`/payer/pay/${paymentId}/confirm`);
    } catch {
      setFailureReason("Network error.");
    } finally {
      setSwitching(false);
    }
  }

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
        <AssetPicker
          options={props.assetOptions.map((o) => ({
            asset: o.asset,
            balance: `${o.available} ${o.asset}`,
            canReceive: o.canReceive,
          }))}
          value={props.asset}
          onChange={switchAsset}
          busy={switching || processing}
        />

        <ConversionBreakdown
          amountPhp={amountPhp}
          asset={props.asset}
          quotedRate={dec(props.quotedRate)}
          amountAsset={amountAsset}
          networkFeeXlm={networkFeeXlm}
        />
        <WalletSourceRow
          publicKey={props.walletPublicKey}
          asset={props.asset}
          availableAsset={availableAsset}
          approxPhp={dec(props.approxPhp)}
          requiredAsset={requiredAsset}
        />

        {expired && (
          <p role="alert" className="text-body-md text-error">
            Quote expired — rescan to get a fresh rate.
          </p>
        )}
        {secondsLeft !== null && secondsLeft > 0 && (
          <p className="text-body-sm text-on-surface-variant">Rate locked for {secondsLeft}s</p>
        )}
        {!processing && failureReason && (
          <p role="alert" className="text-body-md text-error">
            {failureReason}
          </p>
        )}

        <div className="flex flex-wrap gap-stack-md">
          <button
            type="button"
            onClick={confirm}
            disabled={expired || insufficient || processing || switching}
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
