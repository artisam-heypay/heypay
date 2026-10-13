"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dec, displayPhp } from "@/lib/money";
import { readRefusal, type RefusedRequest } from "@/lib/payment-refusal";
import {
  buildEscrowDeposit,
  EscrowDepositBuildError,
  type EscrowDepositInstructions,
} from "@/lib/client/escrow-deposit";
import { signWithFreighter } from "@/components/wallet/freighter";
import { Icon } from "@/components/ui";
import { AssetPicker } from "./AssetPicker";
import { ConversionBreakdown } from "./ConversionBreakdown";
import { PaymentRefusalNotice } from "./PaymentRefusalNotice";
import { WalletSourceRow } from "./WalletSourceRow";
import { ProcessingOverlay } from "./ProcessingOverlay";
import type { PaymentStatus } from "@/generated/prisma/client";

const TERMINAL = new Set(["SETTLED", "FAILED", "REFUNDED"]);

export type ConfirmAssetOption = { asset: string; available: string; canReceive: boolean };

/** The payer's own wallet, when it pays instead of the HeyPay one. */
export type ConfirmOwnWallet = {
  /** The account they connected; the escrow deposit comes from it. */
  address: string;
  /** The network HeyPay runs on; Freighter must be on the same one. */
  networkPassphrase: string;
  networkName: string;
};

/** Where a payment signed in the payer's own wallet has got to. */
type SigningStep = "preparing" | "signing" | "sending";

const SIGNING_STEP_NOTE: Record<SigningStep, string> = {
  preparing: "Preparing the payment…",
  signing: "Approve the payment in Freighter…",
  sending: "Sending the signed payment…",
};

/** Why the escrow deposit could not be built in the browser, as the payer reads it. */
function buildFailure(err: unknown): string {
  if (err instanceof EscrowDepositBuildError) {
    if (err.reason === "account_not_found") {
      return "Your wallet's account was not found on the network. Fund it, then try again.";
    }
    if (err.reason === "simulation_failed") {
      return "The network would not run this payment from your wallet. Check its balance, then try again.";
    }
    return "This payment needs a signature your wallet cannot give.";
  }
  return "Could not prepare the payment. Try again.";
}

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
  /**
   * Set when the payer pays from their own wallet: the balances above are that
   * account's, and the payment is signed in Freighter instead of confirmed
   * with the HeyPay wallet.
   */
  ownWallet?: ConfirmOwnWallet | null;
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
  // Set while a payment is being signed in the payer's own wallet. The progress
  // overlay only takes over once the server has the signed transaction.
  const [signingStep, setSigningStep] = useState<SigningStep | null>(null);
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

  /**
   * Pays from the payer's own wallet. The server says what the escrow deposit
   * must be, this browser builds it, Freighter signs it, and the server checks
   * the signed transaction against the payment before it is sent. HeyPay signs
   * nothing. Until the server has taken it, nothing was sent, so every failure
   * on the way leaves the payment as it was and the payer can try again.
   */
  async function signAndPay() {
    const own = props.ownWallet;
    if (!own) return;
    const stop = (failed: RefusedRequest) => {
      setRefused(failed);
      setSigningStep(null);
    };
    setRefused(null);
    setSigningStep("preparing");
    try {
      const json = { "content-type": "application/json" };
      const prepared = await fetch(`/api/payments/${props.paymentId}/prepare`, {
        method: "POST",
        headers: json,
        body: "{}",
      });
      if (!prepared.ok) {
        const body = await prepared.json().catch(() => null);
        return stop(readRefusal(body, "Could not prepare the payment."));
      }
      const instructions = (await prepared.json()) as EscrowDepositInstructions;

      let deposit: { xdr: string };
      try {
        deposit = await buildEscrowDeposit(instructions);
      } catch (err) {
        return stop({ message: buildFailure(err), refusal: null });
      }

      setSigningStep("signing");
      const signature = await signWithFreighter(deposit.xdr, own);
      if (!signature.ok) return stop({ message: signature.message, refusal: null });

      setSigningStep("sending");
      const res = await fetch(`/api/payments/${props.paymentId}/signed`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ xdr: signature.signedXdr }),
      });
      if (!res.ok) {
        return stop(readRefusal(await res.json().catch(() => null), "Could not send the payment."));
      }
      const { status: s } = (await res.json()) as { status: PaymentStatus };
      setSigningStep(null);
      setStatus(s);
      setProcessing(true);
      poll();
    } catch {
      stop({ message: "Network error. Nothing was sent. Try again.", refusal: null });
    }
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
          busy={switching || processing || signingStep !== null}
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
          own={Boolean(props.ownWallet)}
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

        {signingStep && (
          <p role="status" className="text-body-md text-on-surface-variant">
            {SIGNING_STEP_NOTE[signingStep]}
          </p>
        )}

        <div className="flex flex-wrap gap-stack-md">
          <button
            type="button"
            onClick={props.ownWallet ? signAndPay : confirm}
            disabled={expired || insufficient || processing || switching || signingStep !== null}
            aria-busy={processing || signingStep !== null || undefined}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-stack-sm rounded-full bg-primary px-stack-lg py-4 font-display font-bold text-on-primary disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-primary/10"
          >
            {props.ownWallet ? "Sign with Freighter" : "Confirm"}
            <Icon name={props.ownWallet ? "account_balance_wallet" : "lock"} />
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
