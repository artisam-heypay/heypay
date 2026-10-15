"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dec, displayPhp } from "@/lib/money";
import { readRefusal, type RefusedRequest } from "@/lib/payment-refusal";
import { Icon } from "@/components/ui";
import { AssetPicker } from "./AssetPicker";
import { ConversionBreakdown } from "./ConversionBreakdown";
import { PaymentRefusalNotice } from "./PaymentRefusalNotice";
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
  /** Upper estimate of the escrow deposit's Soroban fee; null when not escrowed. */
  escrowFeeXlm?: string | null;
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
  const escrowFeeXlm = props.escrowFeeXlm ? dec(props.escrowFeeXlm) : null;
  const requiredAsset = isXlm
    ? amountAsset.plus(networkFeeXlm).plus(escrowFeeXlm ?? 0)
    : amountAsset;

  const [processing, setProcessing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [status, setStatus] = useState<PaymentStatus>("AUTHORIZED");
  // Why the payment being followed failed, as the overlay shows it.
  const [failureReason, setFailureReason] = useState<string | null>(null);
  // The last quote or confirmation the server turned down, and why.
  const [refused, setRefused] = useState<RefusedRequest | null>(null);
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
   * this payment and quoting a fresh one rather than mutating it in place. The
   * same goes for trying again in the same asset once a refusal has been fixed.
   */
  async function switchAsset(asset: string) {
    if (switching) return;
    setSwitching(true);
    setRefused(null);
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
        setRefused(readRefusal(await res.json().catch(() => null), `Could not quote in ${asset}.`));
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
      setRefused({ message: "Network error.", refusal: null });
    } finally {
      setSwitching(false);
    }
  }

  async function confirm() {
    setProcessing(true);
    setRefused(null);
    try {
      const res = await fetch(`/api/payments/${props.paymentId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: "{}",
      });
      if (!res.ok) {
        const failed = readRefusal(
          await res.json().catch(() => null),
          "Could not authorize the payment.",
        );
        // A refusal held nothing, so the payer can fix it here and try again.
        if (failed.refusal) {
          setRefused(failed);
          setProcessing(false);
          return;
        }
        setStatus("FAILED");
        setFailureReason(failed.message);
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
          onChange={(asset) => asset !== props.asset && switchAsset(asset)}
          busy={switching || processing}
        />

        <ConversionBreakdown
          amountPhp={amountPhp}
          asset={props.asset}
          quotedRate={dec(props.quotedRate)}
          amountAsset={amountAsset}
          networkFeeXlm={networkFeeXlm}
          escrowFeeXlm={escrowFeeXlm}
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
        {!processing && refused && (
          <PaymentRefusalNotice
            refused={refused}
            currentAsset={props.asset}
            busy={switching}
            onPayWith={switchAsset}
          />
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
