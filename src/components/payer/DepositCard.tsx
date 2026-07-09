"use client";
import { useState } from "react";
import { Card, Icon } from "@/components/ui";

export function DepositCard({ publicKey, qrSvg }: { publicKey: string; qrSvg: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — address is still visible/selectable
    }
  }

  return (
    <Card>
      <h2 className="font-display text-headline-md">Prefund your wallet</h2>
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
          Send only XLM on the Stellar network. No memo is required. Send at least 1 XLM to activate
          your account.
        </span>
      </div>
    </Card>
  );
}
