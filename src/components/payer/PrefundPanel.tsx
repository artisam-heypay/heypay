"use client";
import { useState } from "react";
import Link from "next/link";
import { Card, Icon } from "@/components/ui";

export function PrefundPanel({ publicKey, qrSvg }: { publicKey: string; qrSvg: string }) {
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
      <div className="flex items-center justify-between">
        <h2 className="text-headline-md font-display">Prefund</h2>
        <Link href="/payer/prefund" className="text-body-sm text-primary">
          Details
        </Link>
      </div>
      <div
        className="mx-auto mt-stack-md h-40 w-40 [&>svg]:h-full [&>svg]:w-full"
        aria-label="Deposit QR code"
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
      <div className="mt-stack-md flex items-center gap-stack-sm">
        <code className="truncate text-mono-data text-body-sm">{publicKey}</code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy deposit address"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-surface-container-high focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          <Icon name="content_copy" />
        </button>
      </div>
      <p aria-live="polite" className="mt-stack-sm text-body-sm text-on-surface-variant">
        {copied ? "Copied!" : "Stellar network · no memo required"}
      </p>
    </Card>
  );
}
