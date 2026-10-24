"use client";
import { useState } from "react";
import { QrDownloads } from "./QrDownloads";

export function BusinessQrCard({
  qrSvg,
  paymentLink,
  businessName,
}: {
  qrSvg: string;
  paymentLink: string;
  businessName: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="tonal-card mx-auto flex max-w-lg flex-col items-center gap-stack-lg rounded-xl p-margin-desktop">
      <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">My Business QR</h1>
      <p className="text-center font-display text-headline-md text-on-surface">{businessName}</p>
      <div
        className="w-64 rounded-xl border border-outline-variant bg-surface-container-lowest p-stack-lg [&_svg]:h-full [&_svg]:w-full"
        aria-label="Business QRPH code"
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
      <div className="flex w-full items-center gap-stack-sm rounded-lg bg-surface-container-low px-stack-md py-stack-sm">
        <span className="truncate font-mono text-mono-data text-on-surface-variant">
          {paymentLink}
        </span>
      </div>
      <QrDownloads />
      <button
        onClick={copy}
        className="inline-flex min-h-11 items-center justify-center gap-stack-sm rounded-full px-stack-lg py-stack-sm text-body-md font-medium text-primary hover:bg-primary/5"
      >
        <span className="material-symbols-outlined">{copied ? "check" : "content_copy"}</span>
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
