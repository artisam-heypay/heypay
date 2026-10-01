"use client";
import { useState } from "react";
import Link from "next/link";
import { Card, Icon } from "@/components/ui";

export function PrefundPanel({ publicKey, qrSvg }: { publicKey: string; qrSvg: string }) {
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
      <h2 className="font-display text-headline-md">Prefund</h2>
      <div
        className="mt-stack-md rounded-xl border border-outline-variant p-stack-md [&_svg]:h-full [&_svg]:w-full"
        // qrSvg is generated server-side by the qrcode library (trusted), not user input.
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
      <div className="mt-stack-md flex items-center gap-stack-sm">
        <code className="min-w-0 flex-1 truncate font-mono text-mono-data">{publicKey}</code>
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
        {copied ? "Copied!" : ""}
      </p>
      <p className="mt-stack-sm text-body-sm text-on-surface-variant">
        Stellar network · no memo required
      </p>
      <Link
        href="/payer/prefund"
        className="mt-stack-md inline-block rounded-lg text-body-sm text-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
      >
        Open full prefund →
      </Link>
    </Card>
  );
}
