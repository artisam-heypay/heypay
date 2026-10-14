"use client";
import { useState } from "react";
import { Button } from "@/components/ui";
import { EscrowCallBuildError } from "@/lib/client/escrow-call";
import {
  buildEscrowTimeoutRefund,
  type EscrowTimeoutRefundInstructions,
} from "@/lib/client/escrow-timeout-refund";
import { shortAddress, signWithFreighter } from "@/components/wallet/freighter";
import { WALLET_UPDATED_EVENT } from "./HoldingsLive";

/** The payer's own wallet, when the payment's deposit came from it. */
export type EscrowRefundSigner = {
  /** The account the deposit came from; the refund is signed by it and paid to it. */
  address: string;
  /** The network HeyPay runs on; Freighter must be on the same one. */
  networkPassphrase: string;
  networkName: string;
};

/** Whether the payer can refund a held payment from the escrow, from the payment API. */
export type EscrowRefund = {
  available: boolean;
  secondsUntilAvailable: number;
  /** Past the deadline, but the bank transfer is in progress and can't be stopped. */
  waitingOnPayout?: boolean;
  /**
   * Set when the payer paid from their own wallet: only that account can take
   * the payment back, so the refund is signed in Freighter.
   */
  ownWallet?: EscrowRefundSigner | null;
};

/** What the payment became once the payer took it back. */
export type EscrowRefundResult = { status?: string; failureReason?: string | null };

/** Where a refund signed in the payer's own wallet has got to. */
type SigningStep = "preparing" | "signing" | "sending";

const SIGNING_STEP_NOTE: Record<SigningStep, string> = {
  preparing: "Preparing the refund…",
  signing: "Approve the refund in Freighter…",
  sending: "Sending the signed refund…",
};

function waitLabel(seconds: number): string {
  return seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}

/** What an API error says, or `fallback` when it says nothing. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

/** Why the refund could not be built in the browser, as the payer reads it. */
function buildFailure(err: unknown): string {
  if (err instanceof EscrowCallBuildError) {
    if (err.reason === "account_not_found") {
      return "Your wallet's account was not found on the network.";
    }
    if (err.reason === "simulation_failed") {
      return "The network would not run this refund from your wallet. It needs a little XLM for the network fee.";
    }
    return "This refund needs a signature your wallet cannot give.";
  }
  return "Could not prepare the refund. Try again.";
}

/**
 * Shown while a payment's crypto is held in the escrow, in the payment detail
 * drawer and on the progress screen. Once the escrow's deadline has passed the
 * payer can take it back themselves; the refund then appears in the payment
 * detail as "Timeout refund on Stellar". A payer who paid from the HeyPay
 * wallet has HeyPay sign the refund for them; one who paid from their own
 * wallet signs it in Freighter, because only that account can take it back.
 */
export function EscrowRefundPanel({
  paymentId,
  asset,
  state,
  onRefunded,
}: {
  paymentId: string;
  asset: string;
  state: EscrowRefund;
  onRefunded: (result: EscrowRefundResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingStep, setSigningStep] = useState<SigningStep | null>(null);
  const own = state.ownWallet ?? null;

  async function refund() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/${paymentId}/escrow-refund`, { method: "POST" });
      if (!res.ok) {
        setError(await errorMessage(res, "Could not refund from escrow."));
        return;
      }
      const result = ((await res.json().catch(() => null)) ?? {}) as EscrowRefundResult;
      window.dispatchEvent(new Event(WALLET_UPDATED_EVENT));
      onRefunded(result);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Takes the payment back with the payer's own wallet. The server says what
   * the refund must be, this browser builds it, Freighter signs it, and the
   * server checks the signed transaction before it is sent. Until the server
   * has taken it nothing was sent, so the payer can simply try again.
   */
  async function signAndRefund(signer: EscrowRefundSigner) {
    setBusy(true);
    setError(null);
    setSigningStep("preparing");
    try {
      const prepared = await fetch(`/api/payments/${paymentId}/escrow-refund/prepare`, {
        method: "POST",
      });
      if (!prepared.ok) {
        setError(await errorMessage(prepared, "Could not prepare the refund."));
        return;
      }
      const instructions = (await prepared.json()) as EscrowTimeoutRefundInstructions;

      let built: { xdr: string };
      try {
        built = await buildEscrowTimeoutRefund(instructions);
      } catch (err) {
        setError(buildFailure(err));
        return;
      }

      setSigningStep("signing");
      const signature = await signWithFreighter(built.xdr, signer);
      if (!signature.ok) {
        setError(signature.message);
        return;
      }

      setSigningStep("sending");
      const res = await fetch(`/api/payments/${paymentId}/escrow-refund/signed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ xdr: signature.signedXdr }),
      });
      if (!res.ok) {
        setError(await errorMessage(res, "Could not send the refund."));
        return;
      }
      // The contract paid the payer's own account: no HeyPay balance changed.
      onRefunded(((await res.json().catch(() => null)) ?? {}) as EscrowRefundResult);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSigningStep(null);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-stack-sm rounded-lg bg-surface-container p-stack-md">
      <h3 className="font-display text-body-lg">Held in escrow</h3>
      <p className="text-body-sm text-on-surface-variant">
        {state.waitingOnPayout
          ? `The bank transfer to the merchant is already on its way and can't be stopped, so this payment can't be refunded yet. If the transfer fails, your ${asset} is refunded automatically.`
          : state.available
            ? own
              ? `This payment was not completed in time and can't proceed. You can take your ${asset} back now. It returns to the wallet you paid from (${shortAddress(own.address)}), and you approve it in Freighter.`
              : `This payment was not completed in time and can't proceed. You can take your ${asset} back now.`
            : `If this payment is not completed, you can take your ${asset} back in about ${waitLabel(state.secondsUntilAvailable)}.`}
      </p>
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
      {signingStep && (
        <p role="status" className="text-body-sm text-on-surface-variant">
          {SIGNING_STEP_NOTE[signingStep]}
        </p>
      )}
      {state.available &&
        (own ? (
          <Button
            size="md"
            variant="outline-pill"
            onClick={() => signAndRefund(own)}
            loading={busy}
          >
            {busy ? "Refunding…" : "Get my money back"}
          </Button>
        ) : (
          <Button size="md" variant="outline-pill" onClick={refund} loading={busy}>
            {busy ? "Refunding…" : "Refund from escrow"}
          </Button>
        ))}
    </div>
  );
}
