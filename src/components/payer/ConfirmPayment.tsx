"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dec, displayAsset, displayPhp } from "@/lib/money";
import { bankRefusedPayout } from "@/lib/payment-status";
import { payingWalletChange, readRefusal, type RefusedRequest } from "@/lib/payment-refusal";
import { EscrowCallBuildError } from "@/lib/client/escrow-call";
import { buildEscrowDeposit, type EscrowDepositInstructions } from "@/lib/client/escrow-deposit";
import { signWithFreighter } from "@/components/wallet/freighter";
import { Button, Icon } from "@/components/ui";
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
type SigningStep = "preparing" | "signing" | "resigning" | "sending";

const SIGNING_STEP_NOTE: Record<SigningStep, string> = {
  preparing: "Preparing the payment…",
  signing: "Approve the payment in Freighter…",
  resigning:
    "That approval came after the transaction expired, so nothing was sent. " +
    "Approve the new one in Freighter…",
  sending: "Sending the signed payment…",
};

// A deposit is valid for two minutes at most. One approved after that is asked
// for once more, on a fresh deposit, before the payer is told to start again.
const SIGN_ATTEMPTS = 2;

/** Why the server did not take a signed deposit, when it says so. */
function signedRefusalReason(body: unknown): string | null {
  const reason = (body as { error?: { details?: { reason?: unknown } } } | null)?.error?.details
    ?.reason;
  return typeof reason === "string" ? reason : null;
}

/** Why the escrow deposit could not be built in the browser, as the payer reads it. */
function buildFailure(err: unknown): string {
  if (err instanceof EscrowCallBuildError) {
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
  // The button names what leaves the wallet, as "Most taken from your wallet"
  // does. Only an XLM payment's escrow fee is a most, not an exact amount.
  const payLabel = `Pay ${isXlm && escrowFeeXlm ? "up to " : ""}${displayAsset(requiredAsset, props.asset)}`;

  const [processing, setProcessing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [status, setStatus] = useState<PaymentStatus>("AUTHORIZED");
  // Why the payment being followed failed, as the overlay shows it.
  const [failureReason, setFailureReason] = useState<string | null>(null);
  // The shop's bank refused the payout. Read from the status poll.
  const [bankRefused, setBankRefused] = useState(false);
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
        const body: unknown = await res.json().catch(() => null);
        const failed = readRefusal(body, "Could not authorize the payment.");
        // The payer turned on their own wallet after this page was drawn. The
        // HeyPay wallet paid nothing; draw the page again for the wallet that pays.
        if (payingWalletChange(body) === "own_wallet_pays") {
          setRefused(failed);
          setProcessing(false);
          router.refresh();
          return;
        }
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
        setBankRefused(bankRefusedPayout(payment.failureReason));
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
    // The payer switched back to their HeyPay wallet (or own wallets were turned
    // off) after this page was drawn. Nothing was signed for it or sent; draw
    // the page again for the HeyPay wallet, which they confirm with as usual.
    const backToHeyPayWallet = () => {
      stop({
        message:
          "You switched back to your HeyPay wallet, so nothing was sent from your own wallet. " +
          "Check the wallet below, then confirm.",
        refusal: null,
      });
      router.refresh();
    };
    const wrongWallet = (res: Response, body: unknown) =>
      res.status === 404 || payingWalletChange(body) === "heypay_wallet_pays";

    setRefused(null);
    try {
      const json = { "content-type": "application/json" };
      for (let attempt = 1; ; attempt++) {
        setSigningStep(attempt === 1 ? "preparing" : "resigning");
        const prepared = await fetch(`/api/payments/${props.paymentId}/prepare`, {
          method: "POST",
          headers: json,
          body: "{}",
        });
        if (!prepared.ok) {
          const body: unknown = await prepared.json().catch(() => null);
          if (wrongWallet(prepared, body)) return backToHeyPayWallet();
          return stop(readRefusal(body, "Could not prepare the payment."));
        }
        const instructions = (await prepared.json()) as EscrowDepositInstructions;

        let deposit: { xdr: string };
        try {
          deposit = await buildEscrowDeposit(instructions);
        } catch (err) {
          return stop({ message: buildFailure(err), refusal: null });
        }

        if (attempt === 1) setSigningStep("signing");
        const signature = await signWithFreighter(deposit.xdr, own);
        if (!signature.ok) return stop({ message: signature.message, refusal: null });

        // Approved after the deposit stopped being valid: the network would turn
        // it down, so it is not sent.
        const late = Date.now() >= Date.parse(instructions.validUntil);
        if (!late) {
          setSigningStep("sending");
          const res = await fetch(`/api/payments/${props.paymentId}/signed`, {
            method: "POST",
            headers: json,
            body: JSON.stringify({ xdr: signature.signedXdr }),
          });
          if (res.ok) {
            const { status: s } = (await res.json()) as { status: PaymentStatus };
            setSigningStep(null);
            setStatus(s);
            setProcessing(true);
            poll();
            return;
          }
          const body: unknown = await res.json().catch(() => null);
          if (wrongWallet(res, body)) return backToHeyPayWallet();
          if (signedRefusalReason(body) !== "expired") {
            return stop(readRefusal(body, "Could not send the payment."));
          }
        }
        if (attempt === SIGN_ATTEMPTS) {
          return stop({
            message:
              "The transaction expired before it was approved, so nothing was sent. Try again.",
            refusal: null,
          });
        }
      }
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

        {expired ? (
          // A payer who stopped to read gets a new price here, without scanning again.
          <div className="flex flex-wrap items-center gap-stack-md">
            <p role="status" className="text-body-md text-on-surface-variant">
              This price ran out.
            </p>
            <Button
              type="button"
              size="md"
              variant="outline-pill"
              disabled={switching || processing}
              onClick={() => switchAsset(props.asset)}
            >
              Get a new price
            </Button>
          </div>
        ) : (
          secondsLeft !== null && (
            <p className="text-body-sm text-on-surface-variant">Rate locked for {secondsLeft}s</p>
          )
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
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-stack-sm rounded-full bg-primary px-stack-lg py-4 font-display font-bold text-on-primary disabled:opacity-60"
          >
            {props.ownWallet ? "Sign with Freighter" : payLabel}
            <Icon name={props.ownWallet ? "account_balance_wallet" : "lock"} />
          </button>
          {/* Not while a payment is being signed or sent: it may already be on its way. */}
          <button
            type="button"
            onClick={cancel}
            disabled={processing || signingStep !== null}
            className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-primary px-stack-lg py-4 font-display font-bold text-primary hover:bg-primary/5 disabled:opacity-60"
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
          bankRefused={bankRefused}
        />
      )}
    </>
  );
}
