"use client";
import { useState } from "react";
import { Card, Icon } from "@/components/ui";

export function DepositCard({ publicKey, qrSvg }: { publicKey: string; qrSvg: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable → no-op
    }
  };

  return (
    <Card>
      <h2 className="text-headline-md font-display">Prefund your wallet</h2>
      <div
        className="mx-auto mt-stack-md w-48 rounded-xl border border-outline-variant p-stack-md [&>svg]:h-full [&>svg]:w-full"
        aria-label="Deposit QR code"
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
      <div className="mt-stack-md flex items-center gap-stack-sm">
        <code className="select-all break-all text-mono-data text-body-sm">{publicKey}</code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy deposit address"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-surface-container-high focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          <Icon name="content_copy" />
        </button>
      </div>
      <p aria-live="polite" className="mt-stack-sm min-h-[1.25rem] text-body-sm text-primary">
        {copied ? "Address copied" : ""}
      </p>
      <div className="mt-stack-md flex items-start gap-stack-sm text-body-sm text-on-surface-variant">
        <Icon name="info" className="text-primary" />
        <div>
          <p>Send only XLM on the Stellar network · No memo required.</p>
          <p>Send at least 1 XLM to activate your account.</p>
        </div>
      </div>
    </Card>
  );
}
