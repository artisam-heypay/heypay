"use client";
import { useState } from "react";
import { Card, Icon } from "@/components/ui";

export function DepositCard({
  publicKey,
  qrSvg,
  asset = "XLM",
  issuer = null,
  trustlineRequired = false,
  canReceive = true,
  onTrustlineEstablished,
}: {
  publicKey: string;
  qrSvg: string;
  asset?: string;
  /**
   * The issuer account this asset must come from. On Stellar an asset is the
   * `code:issuer` pair — a same-named token from any other issuer is a
   * different asset and the deposit will be rejected, so the payer must be
   * able to compare this against what their wallet actually holds.
   */
  issuer?: string | null;
  /** True for issued assets (USDC/USDT), which the network won't deliver untrusted. */
  trustlineRequired?: boolean;
  canReceive?: boolean;
  onTrustlineEstablished?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [issuerCopied, setIssuerCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsTrustline = trustlineRequired && !canReceive;

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — address is still visible/selectable
    }
  }

  async function copyIssuer() {
    if (!issuer) return;
    try {
      await navigator.clipboard.writeText(issuer);
      setIssuerCopied(true);
      setTimeout(() => setIssuerCopied(false), 2000);
    } catch {
      // clipboard unavailable — issuer is still visible/selectable
    }
  }

  async function establishTrustline() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/trustline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ asset }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? `Could not enable ${asset}.`);
        return;
      }
      onTrustlineEstablished?.();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="font-display text-headline-md">Prefund your wallet</h2>

      {needsTrustline ? (
        // Showing the address before the trustline exists invites a deposit the
        // network will reject, so gate it behind the one-time setup.
        <div className="mt-stack-md flex flex-col gap-stack-md rounded-lg bg-surface-container p-stack-md">
          <p className="text-body-md">
            Your wallet needs a one-time trustline before it can receive {asset}. This costs a small
            XLM reserve (0.5 XLM, refundable) plus a network fee.
          </p>
          <button
            type="button"
            onClick={establishTrustline}
            disabled={busy}
            aria-busy={busy || undefined}
            className="inline-flex min-h-11 items-center justify-center gap-stack-sm rounded-full bg-primary px-stack-lg py-3 font-display font-bold text-on-primary disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-primary/10"
          >
            {busy ? "Enabling…" : `Enable ${asset}`}
            <Icon name="link" />
          </button>
          {error && (
            <p role="alert" className="text-body-sm text-error">
              {error}
            </p>
          )}
        </div>
      ) : (
        <>
          <div
            className="mx-auto mt-stack-md w-48 rounded-xl border border-outline-variant p-stack-md [&_svg]:h-full [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <div className="mt-stack-md flex items-center gap-stack-sm">
            <code className="min-w-0 flex-1 select-all break-all font-mono text-mono-data">
              {publicKey}
            </code>
            <button
              type="button"
              onClick={copy}
              aria-label="Copy deposit address"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high focus:outline-none focus:ring-4 focus:ring-primary/10"
            >
              <Icon name="content_copy" />
            </button>
          </div>
          <p aria-live="polite" className="mt-1 h-4 text-body-sm text-primary">
            {copied ? "Address copied" : ""}
          </p>
          <div className="mt-stack-md flex items-start gap-stack-sm rounded-lg bg-surface-container p-stack-md text-body-sm text-on-surface-variant">
            <Icon name="info" className="text-primary" />
            <span>
              Send only {asset} on the Stellar network. No memo is required.{" "}
              {asset === "XLM"
                ? "Send at least 1 XLM to activate your account."
                : "Keep a little XLM in the wallet to cover network fees."}
            </span>
          </div>
        </>
      )}

      {issuer && (
        <div className="mt-stack-md rounded-lg bg-surface-container p-stack-md">
          <p className="text-body-sm text-on-surface-variant">
            Accepted {asset} issuer — a {asset} token from any other issuer is a different asset and
            will be rejected:
          </p>
          <div className="mt-1 flex items-center gap-stack-sm">
            <code className="min-w-0 flex-1 select-all break-all font-mono text-mono-data">
              {issuer}
            </code>
            <button
              type="button"
              onClick={copyIssuer}
              aria-label="Copy asset issuer"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high focus:outline-none focus:ring-4 focus:ring-primary/10"
            >
              <Icon name="content_copy" />
            </button>
          </div>
          <p aria-live="polite" className="mt-1 h-4 text-body-sm text-primary">
            {issuerCopied ? "Issuer copied" : ""}
          </p>
        </div>
      )}
    </Card>
  );
}
