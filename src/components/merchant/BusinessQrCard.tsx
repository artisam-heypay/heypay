"use client";
import { useState } from "react";

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

  function download() {
    const blob = new Blob([qrSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${businessName.replace(/\s+/g, "-").toLowerCase()}-qrph.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    await navigator.clipboard.writeText(paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="tonal-card mx-auto flex max-w-lg flex-col items-center gap-stack-lg rounded-xl p-margin-desktop">
      <h1 className="text-headline-lg-mobile lg:text-headline-lg">My Business QR</h1>
      <p className="text-headline-md text-on-surface">{businessName}</p>
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
      <div className="flex w-full gap-stack-md">
        <button
          onClick={download}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-stack-sm rounded-full bg-primary px-stack-lg py-stack-sm text-body-md font-semibold text-on-primary shadow-lg shadow-primary/20"
        >
          <span className="material-symbols-outlined">download</span>Download
        </button>
        <button
          onClick={copy}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-stack-sm rounded-full border-2 border-primary px-stack-lg py-stack-sm text-body-md font-medium text-primary"
        >
          <span className="material-symbols-outlined">{copied ? "check" : "content_copy"}</span>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
