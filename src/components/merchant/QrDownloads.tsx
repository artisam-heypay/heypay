const LINK =
  "inline-flex min-h-11 flex-1 items-center justify-center gap-stack-sm rounded-full px-stack-lg py-stack-sm text-body-md font-semibold whitespace-nowrap";

/** Download links for the merchant's QR: a PNG of the code, and a PDF standee to print. */
export function QrDownloads() {
  return (
    <div className="flex w-full flex-wrap gap-stack-md">
      <a
        href="/api/merchant/qr/download?format=pdf"
        download
        className={`${LINK} bg-primary text-on-primary shadow-lg shadow-primary/20`}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          print
        </span>
        Download PDF
      </a>
      <a
        href="/api/merchant/qr/download?format=png"
        download
        className={`${LINK} border-2 border-primary text-primary`}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          image
        </span>
        Download PNG
      </a>
    </div>
  );
}
